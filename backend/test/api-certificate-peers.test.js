import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { addCertificate, created } from "./support/hosts.js";

// Two hosts force HTTPS with one certificate whose key file is gone. A save of one must render both without the
// HTTPS listener in one batch: nginx checks every config, so the other host's old config (still naming the missing
// key) would otherwise fail the saved host's reload.

let api;
let admin;
before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const proxy = (name, certificate) => ({
	domain_names: [`${name}.example.com`],
	forward_scheme: "http",
	forward_host: "10.0.8.1",
	forward_port: 80,
	certificate_id: certificate,
	ssl_forced: true,
});

it("saves a host whose certificate lost its key together with the other hosts on that certificate", async () => {
	const certificate = await addCertificate(api, { domain: "peers.example.com" });
	const a = await created(await admin.post("/nginx/proxy-hosts", proxy("peer-a", certificate)), "create a");
	const b = await created(await admin.post("/nginx/proxy-hosts", proxy("peer-b", certificate)), "create b");
	const dead = await created(
		await admin.post("/nginx/dead-hosts", {
			domain_names: ["peer-c.example.com"],
			certificate_id: certificate,
			ssl_forced: true,
		}),
		"create c",
	);
	await rm(path.join(api.root, `data/tls/custom/npm-${certificate}/privkey.pem`));
	// nginx (-t and the reload) refuses every config that still names the missing key
	const key = `npm-${certificate}/privkey.pem`;
	const stale = `grep -qs "${key}" "${api.root}"/data/nginx/proxy_host/*.conf "${api.root}"/data/nginx/dead_host/*.conf`;
	await api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\nif ${stale}; then echo "cannot load certificate key" >&2; exit 1; fi\n`,
	);
	api.outside.control.check = () => {
		try {
			execSync(stale);
			return "nginx: [emerg] cannot load certificate key";
		} catch {
			return null;
		}
	};
	try {
		const saved = await admin.put(`/nginx/proxy-hosts/${a.id}`, { forward_port: 81 });
		assert.equal(saved.status, 200, saved.text);
		assert.equal(saved.body.npmpro_nginx_online, true, saved.body.npmpro_nginx_err);
		for (const [dir, id] of [
			["proxy_host", b.id],
			["dead_host", dead.id],
		]) {
			const config = await api.read(`data/nginx/${dir}/${id}.conf`);
			assert.doesNotMatch(config, /privkey\.pem/u);
			assert.equal((await api.db(dir).where({ id }).first()).npmpro_nginx_online, 1);
		}
	} finally {
		api.outside.control.check = null;
		await rm(path.join(api.root, "fake/nginx.hook"), { force: true });
	}
});

it("leaves the other hosts alone while the certificate is usable", async () => {
	const certificate = await addCertificate(api, { domain: "peers-ok.example.com" });
	const a = await created(await admin.post("/nginx/proxy-hosts", proxy("peer-ok-a", certificate)), "create a");
	const b = await created(await admin.post("/nginx/proxy-hosts", proxy("peer-ok-b", certificate)), "create b");
	const file = path.join(api.root, `data/nginx/proxy_host/${b.id}.conf`);
	await writeFile(file, `${await api.read(`data/nginx/proxy_host/${b.id}.conf`)}\n# untouched\n`);
	assert.equal((await admin.put(`/nginx/proxy-hosts/${a.id}`, { forward_port: 82 })).status, 200);
	assert.match(await api.read(`data/nginx/proxy_host/${b.id}.conf`), /# untouched/u);
});
