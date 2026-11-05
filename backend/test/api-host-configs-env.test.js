import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, created, readConfig } from "./support/hosts.js";

// The same host configs under the opposite environment of api-host-configs.test.js: HTTP, IPv6 and HTTP/3 switched
// off, PROXY protocol on the HTTPS listener, MPTCP and OCSP stapling on (templates/_common.conf, stream.conf).

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
	ctx.admin = await ctx.api.admin();
});
after(() => ctx.api?.stop());

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
