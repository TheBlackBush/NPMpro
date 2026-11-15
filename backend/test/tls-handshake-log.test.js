import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const ENVS_SH = new URL("../../rootfs/usr/local/bin/envs.sh", import.meta.url);
const NPMPRO_CONF = new URL("../../rootfs/usr/local/nginx/conf/conf.d/npmpro.conf", import.meta.url);
const SERVER_OPEN = /\bserver \{/u;
const TEMPLATE_VERSION = /^TV="(?<version>\d+)"$/mu;
const INCLUDE = "include /data/npmpro/nginx/tls-log.conf;";

let api;
const loaded = {};
before(async () => {
	api = await startApi();
	loaded.nginx = (await import("../internal/nginx.js")).default;
});
after(() => api?.stop());

const serversOf = (text) => text.split(SERVER_OPEN).slice(1);
const count = (text, line) => text.split("\n").filter((l) => l.trim() === line).length;

for (const value of ["444", "congratulations", "404", "html", "redirect"]) {
	it(`the default site (${value}) includes the TLS handshake log in its default server only`, async () => {
		const meta = value === "redirect" ? { redirect: "https://example.org" } : {};
		const servers = serversOf(await loaded.nginx.renderConfig("default", { id: "default-site", value, meta }));
		assert.equal(servers.length, 2);
		assert.equal(count(servers[0], INCLUDE), 0);
		assert.ok(servers[1].includes("default_server"));
		assert.equal(count(servers[1], INCLUDE), 1);
	});
}

it("the admin UI includes the TLS handshake log in its default server only", () => {
	const servers = serversOf(readFileSync(NPMPRO_CONF, "utf8"));
	const [reject, admin] = servers.filter((s) => s.includes("listen 0.0.0.0:81"));
	assert.equal(count(reject, INCLUDE), 0);
	assert.ok(admin.includes("default_server"));
	assert.equal(count(admin, INCLUDE), 1);
});

it("bumps the template version for the default site include", () => {
	const version = TEMPLATE_VERSION.exec(readFileSync(ENVS_SH, "utf8"))?.groups.version;
	assert.ok(Number(version) >= 27, `TV is ${version}`);
});
