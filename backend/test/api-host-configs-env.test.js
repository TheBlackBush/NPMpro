import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it, mock } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, created, readConfig } from "./support/hosts.js";

// The same host configs under the opposite environment of api-host-configs.test.js: HTTP, IPv6 and HTTP/3 switched
// off, PROXY protocol on the HTTPS listener, MPTCP and OCSP stapling on (templates/_common.conf, stream.conf).

const MINUTE = 60 * 1000;
const ctx = {};
const URL = "/nginx/proxy-hosts";
let counter = 0;
const body = (overrides = {}) => {
	counter += 1;
	return {
		domain_names: [`env${counter}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.7.${counter}`,
		forward_port: 8000 + counter,
		...overrides,
	};
};
const read = (file) => readConfig(ctx.api, file);
const proxyConfig = async (host) => read(`data/nginx/proxy_host/${host.id}.conf`);

before(async () => {
	// before startApi: the OCSP fetcher takes Date.now once, when its module loads, so the mock has to be there first
	mock.timers.enable({ apis: ["Date"], now: Date.now() });
	ctx.api = await startApi({
		env: {
			IPV4_BINDING: "127.0.0.1",
			IPV6_BINDING: "[::1]",
			HTTP_PORT: "8080",
			HTTPS_PORT: "8443",
			DISABLE_HTTP: "true",
			DISABLE_IPV6: "true",
			DISABLE_H3_QUIC: "true",
			LISTEN_PROXY_PROTOCOL_HTTP: "true",
			LISTEN_PROXY_PROTOCOL_HTTPS: "true",
			ENABLE_MPTCP: "true",
			CUSTOM_OCSP_STAPLING: "true",
		},
	});
	// a login in the same second as the first user is refused (token_valid_after)
	mock.timers.tick(5000);
	ctx.admin = await ctx.api.admin();
});
after(() => {
	mock.timers.reset();
	return ctx.api?.stop();
});

it("writes no HTTP listener and no IPv6 listener, and keeps the internal socket", async () => {
	const host = await created(await ctx.admin.post(URL, body()), "create");
	const config = await proxyConfig(host);
	assert.match(config, /listen unix:\/run\/nginx\.sock;/u);
	assert.doesNotMatch(config, /listen 127\.0\.0\.1:8080/u);
	assert.doesNotMatch(config, /\[::1?\]/u);
	assert.doesNotMatch(config, /proxy_protocol/u);
});

it("writes the HTTPS listener with the PROXY protocol on the configured address and port, and no HTTP/3", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "env-tls.example.com" });
	const host = await created(
		await ctx.admin.post(
			URL,
			body({ domain_names: ["env-tls.example.com"], certificate_id: certificate, npmpro_http3_support: true }),
		),
		"create",
	);
	assert.equal(host.npmpro_http3_support, true);
	const config = await proxyConfig(host);
	assert.match(config, /listen 127\.0\.0\.1:8443 ssl proxy_protocol;/u);
	assert.doesNotMatch(config, /listen 127\.0\.0\.1:8080/u);
	assert.doesNotMatch(config, /quic/u);
	assert.doesNotMatch(config, /Alt-Svc/u);
	assert.doesNotMatch(config, /\[::1\]/u);
});

it("stapling is written only when the OCSP response file of the certificate exists", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "env-ocsp.example.com" });
	const host = await created(
		await ctx.admin.post(URL, body({ domain_names: ["env-ocsp.example.com"], certificate_id: certificate })),
		"create",
	);
	assert.doesNotMatch(await proxyConfig(host), /ssl_stapling/u);
	await mkdir(path.join(ctx.api.root, "data/tls/custom"), { recursive: true });
	await writeFile(path.join(ctx.api.root, `data/tls/custom/npm-${certificate}.der`), "ocsp");
	const saved = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8999 });
	assert.equal(saved.status, 200, saved.text);
	const config = await proxyConfig(host);
	assert.match(config, /ssl_stapling on;\s+ssl_stapling_verify on;/u);
	assert.match(config, new RegExp(`ssl_stapling_file /data/tls/custom/npm-${certificate}\\.der;`, "u"));
	assert.match(config, /ssl_certificate_compression off;/u);
});

// The fake fetcher records every run in fake/ocsp-fetcher.log and writes the .der of each given certificate id.
const fetcherRuns = async () =>
	(await readFile(path.join(ctx.api.root, "fake/ocsp-fetcher.log"), "utf8").catch(() => ""))
		.trim()
		.split("\n")
		.filter(Boolean);
const installFetcher = async (certificate) => {
	const script = path.join(ctx.api.root, "bin/certbot-ocsp-fetcher.sh");
	await writeFile(
		script,
		`#!/bin/sh
printf '%s\\n' "$*" >> "${ctx.api.root}/fake/ocsp-fetcher.log"
printf ocsp > "${ctx.api.root}/data/tls/custom/npm-${certificate}.der"
`,
		{ mode: 0o755 },
	);
};

// The fetcher already ran once at startup (every reload fetches for a kind that has stapling on) and is bounded to one
// run per 10 minutes per kind, so these tests move the clock instead of waiting.
it("runs the OCSP fetcher once for the custom certificates when a host is saved without an OCSP file", async () => {
	const now = Date.now();
	try {
		mock.timers.tick(11 * MINUTE);
		const certificate = await addCertificate(ctx.api, { domain: "env-fetch.example.com" });
		await installFetcher(certificate);
		const host = await created(
			await ctx.admin.post(URL, body({ domain_names: ["env-fetch.example.com"], certificate_id: certificate })),
			"create",
		);
		const runs = await fetcherRuns();
		assert.equal(runs.length, 1);
		assert.match(runs[0], /-c \S+\/data\/tls\/custom -o \S+\/data\/tls\/custom /u);
		const config = await proxyConfig(host);
		assert.match(config, new RegExp(`ssl_stapling_file /data/tls/custom/npm-${certificate}\\.der;`, "u"));
		const saved = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8998 });
		assert.equal(saved.status, 200, saved.text);
		assert.equal((await fetcherRuns()).length, 1);
	} finally {
		mock.timers.setTime(now);
	}
});

// BUG-14 is about this: within the bound a save without an OCSP file runs nothing and stapling stays off
it("does not run the OCSP fetcher again within its interval when a host without an OCSP file is saved", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "env-bound.example.com" });
	await installFetcher(certificate);
	const before = (await fetcherRuns()).length;
	const host = await created(
		await ctx.admin.post(URL, body({ domain_names: ["env-bound.example.com"], certificate_id: certificate })),
		"create",
	);
	const saved = await ctx.admin.put(`${URL}/${host.id}`, { forward_port: 8997 });
	assert.equal(saved.status, 200, saved.text);
	assert.equal((await fetcherRuns()).length, before);
	assert.doesNotMatch(await proxyConfig(host), /ssl_stapling/u);
});

it("writes a stream on the configured address with MPTCP and without IPv6", async () => {
	const stream = await created(
		await ctx.admin.post("/nginx/streams", {
			incoming_port: "9900",
			forwarding_host: "10.0.8.1",
			forwarding_port: "22",
			tcp_forwarding: true,
			udp_forwarding: true,
		}),
		"stream",
	);
	const config = await read(`data/nginx/stream/${stream.id}.conf`);
	assert.match(config, /listen 127\.0\.0\.1:9900 reuseport deferred multipath so_keepalive=on;/u);
	assert.match(config, /listen 127\.0\.0\.1:9900 udp reuseport;/u);
	assert.doesNotMatch(config, /\[::1\]/u);
});

it("stapling is written into a stream with a certificate once its OCSP file exists", async () => {
	const certificate = await addCertificate(ctx.api, { domain: "env-stream.example.com" });
	await writeFile(path.join(ctx.api.root, `data/tls/custom/npm-${certificate}.der`), "ocsp");
	const stream = await created(
		await ctx.admin.post("/nginx/streams", {
			incoming_port: "9901",
			forwarding_host: "10.0.8.2",
			forwarding_port: "22",
			tcp_forwarding: true,
			certificate_id: certificate,
		}),
		"stream",
	);
	const config = await read(`data/nginx/stream/${stream.id}.conf`);
	assert.match(config, /listen 127\.0\.0\.1:9901 ssl reuseport deferred multipath/u);
	assert.match(config, new RegExp(`ssl_stapling_file /data/tls/custom/npm-${certificate}\\.der;`, "u"));
});
