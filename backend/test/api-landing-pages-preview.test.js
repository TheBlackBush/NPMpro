import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, it } from "node:test";
import { scriptHash } from "../landing-pages/build.js";
import { startApi } from "./support/api.js";

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("the built-in and global pages with sample values", async () => {
	const res = await admin.get("/settings/landing-pages/preview/npmpro/upstream_error");
	assert.equal(res.status, 200);
	assert.match(res.headers.get("content-type"), /text\/html/u);
	assert.match(res.text, /<div class="code">502<\/div>/u);
	assert.match(res.text, /IP 203\.0\.113\.7/u);
	assert.doesNotMatch(res.text, /<!--#/u);
	const ban = await admin.get("/settings/landing-pages/preview/global/ban");
	assert.match(ban.text, /<div class="code">403<\/div>/u);
	const captcha = await admin.get("/settings/landing-pages/preview/global/captcha");
	assert.doesNotMatch(captcha.text, /\{\{captcha_/u);
	const site = await admin.get("/settings/landing-pages/preview/global/default_site");
	assert.match(site.text, /NPMpro is running/u);
	const cert = await admin.get("/settings/landing-pages/preview/npmpro/certificate");
	assert.match(cert.text, /<div class="code">495<\/div>/u);
});

it("a place's page: its own, the global one, nothing for the upstream's own answer", async () => {
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["preview.example.com"],
		forward_host: "127.0.0.1",
		forward_port: 8080,
		npmpro_page_maintenance: "custom",
		npmpro_page_maintenance_html: '<p>back at <!--# echo var="host" --></p>',
	});
	assert.equal(host.status, 201, host.text);
	const mine = await admin.get(`/settings/landing-pages/preview/proxy-host/${host.body.id}/maintenance`);
	assert.equal(mine.text, "<p>back at example.com</p>");
	const global = await admin.get(`/settings/landing-pages/preview/proxy-host/${host.body.id}/upstream_error`);
	assert.match(global.text, /Site unavailable/u);
	assert.equal((await admin.get(`/settings/landing-pages/preview/proxy-host/${host.body.id}/not_found`)).status, 404);
	assert.equal((await admin.get(`/settings/landing-pages/preview/proxy-host/${host.body.id}/nope`)).status, 404);
	const list = await admin.post("/nginx/access-lists", {
		name: "preview",
		npmpro_denied_page: "plain",
		items: [],
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal((await admin.get(`/settings/landing-pages/preview/access-list/${list.body.id}`)).status, 404);
	const dead = await admin.post("/nginx/dead-hosts", { domain_names: ["preview-dead.example.com"] });
	assert.match(
		(await admin.get(`/settings/landing-pages/preview/dead-host/${dead.body.id}`)).text,
		/Page not found/u,
	);
	assert.equal((await admin.get("/settings/landing-pages/preview/global/nope")).status, 404);
	assert.equal((await admin.get("/settings/landing-pages/preview/proxy-host/999999/maintenance")).status, 404);
	assert.equal((await admin.get("/settings/landing-pages/preview/proxy-host/abc/maintenance")).status, 404);
	assert.equal((await admin.get("/settings/landing-pages/preview/proxy-host/0/maintenance")).status, 404);
	assert.equal((await admin.get("/settings/landing-pages/preview/dead-host/-1")).status, 404);
	assert.equal((await admin.get("/settings/landing-pages/preview/other/ban")).status, 404);
});

it("admins only", async () => {
	const user = await api.limited({
		visibility: "all",
		access_lists: "manage",
		proxy_hosts: "manage",
		certificates: "view",
	});
	assert.equal((await user.get("/settings/landing-pages/preview/npmpro/ban")).status, 403);
});

it("nginx serves the previews sandboxed, scripts limited to the built-in pages' one script", async () => {
	const conf = await readFile(
		new URL("../../rootfs/usr/local/nginx/conf/conf.d/npmpro.conf", import.meta.url),
		"utf8",
	);
	const block = conf.slice(conf.indexOf("location ~ ^/api/settings/(landing-pages/preview/"));
	const csp = block.slice(0, block.indexOf("\n", block.indexOf("Content-Security-Policy")));
	assert.ok(csp.includes(`script-src '${scriptHash()}';`), "the hash of backend/landing-pages/page-script.js");
	assert.ok(csp.includes("sandbox allow-scripts;"));
	assert.ok(!csp.includes("allow-same-origin"));
	assert.ok(csp.includes("default-src 'none';"));
	assert.ok(csp.includes("img-src data:;"));
});
