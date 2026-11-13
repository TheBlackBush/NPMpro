import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists } from "./support/hosts.js";

// Landing pages in backups (Settings, Landing pages is the settings_landing_pages type): the row and the custom pages
// of hosts and access lists travel with their types, a restore or merge checks every page like the API and writes the
// page files again.

let api;
let admin;
let count = 0;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const BASE = "/backups";
const BAD = '<!--# include virtual="/" -->';
const keep = async (types) => {
	const done = await admin.post(BASE, { types, secrets: false, keep: true });
	assert.equal(done.status, 200, done.text);
	return done.body.entry;
};
const restore = async (entry, types, extra = {}) => {
	const { token } = (await admin.post(`${BASE}/${entry.name}/inspect`, {})).body;
	const done = await admin.post(`${BASE}/restore/${token}`, { types, confirm: true, ...extra });
	assert.equal(done.status, 200, done.text);
	return done;
};
const proxy = async (extra = {}) => {
	count += 1;
	const done = await admin.post("/nginx/proxy-hosts", {
		domain_names: [`bk-pages${count}.example.com`],
		forward_host: "127.0.0.1",
		forward_port: 8080,
		...extra,
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const rowOf = (table, id) => api.db(table).where({ id }).first();

it("the landing pages travel in a backup and a restore writes their files", async () => {
	await admin.put("/settings/landing-pages", {
		pages: { maintenance: { choice: "custom", html: "<p>backed up</p>" } },
	});
	const types = await admin.get(`${BASE}/types`);
	assert.ok(JSON.stringify(types.body).includes("settings_landing_pages"));
	assert.equal(types.body.counts.settings_landing_pages, 1);
	const entry = await keep(["settings_landing_pages"]);
	await admin.put("/settings/landing-pages", { pages: { maintenance: { choice: "npmpro" } } });
	assert.match(await api.read("/data/public/pages/global/maintenance.html"), /Back soon/u);
	await restore(entry, ["settings_landing_pages"]);
	assert.equal((await admin.get("/settings/landing-pages")).body.pages.maintenance.choice, "custom");
	assert.equal(await api.read("/data/public/pages/global/maintenance.html"), "<p>backed up</p>");
});

it("a backup page that fails the API checks is not restored: the row falls back to the NPMpro page", async () => {
	await admin.put("/settings/landing-pages", { pages: { ban: { choice: "custom", html: "<p>fine</p>" } } });
	const entry = await keep(["settings_landing_pages"]);
	// a crafted row: the API would refuse this page
	const row = await rowOf("setting", "landing_pages");
	const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
	meta.pages.ban.html = BAD;
	await api
		.db("setting")
		.where({ id: "landing_pages" })
		.update({ meta: JSON.stringify(meta) });
	const crafted = await keep(["settings_landing_pages"]);
	await restore(crafted, ["settings_landing_pages"]);
	const view = (await admin.get("/settings/landing-pages")).body;
	assert.equal(view.pages.ban.choice, "npmpro");
	assert.match(await api.read("/data/public/pages/global/ban.html"), /<html/u);
	assert.equal((await api.read("/data/public/pages/global/ban.html")).includes("include virtual"), false);
	await restore(entry, ["settings_landing_pages"]);
	assert.equal((await admin.get("/settings/landing-pages")).body.pages.ban.html, "<p>fine</p>");
});

it("a restore of a database without the landing_pages row falls back to the defaults", async () => {
	await admin.put("/settings/landing-pages", { pages: { denied: { choice: "custom", html: "<p>no</p>" } } });
	const entry = await keep(["settings_landing_pages"]);
	// a backup made before the row existed
	const dump = await api.db("setting").where({ id: "landing_pages" }).del();
	assert.equal(dump, 1);
	const without = await keep(["settings_landing_pages"]);
	assert.equal(without.summary.counts.settings_landing_pages, 0);
	await admin.put("/settings/landing-pages", { pages: { denied: { choice: "custom", html: "<p>no</p>" } } });
	assert.equal((await admin.get("/settings/landing-pages")).status, 200);
	await restore(without, ["settings_landing_pages"]);
	assert.equal(await api.db("setting").where({ id: "landing_pages" }).first(), undefined);
	const view = await admin.get("/settings/landing-pages");
	assert.equal(view.status, 200);
	assert.equal(view.body.pages.denied.choice, "npmpro");
	assert.match(await api.read("/data/public/pages/global/denied.html"), /<html/u);
	await restore(entry, ["settings_landing_pages"]);
	assert.equal((await admin.get("/settings/landing-pages")).body.pages.denied.choice, "custom");
});

it("a restore writes the page files of every restored host and access list and drops the folders of gone rows", async () => {
	const host = await proxy({ npmpro_page_maintenance: "custom", npmpro_page_maintenance_html: "<p>m</p>" });
	const list = await admin.post("/nginx/access-lists", {
		name: "bk-pages-list",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>denied here</p>",
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal(list.status, 201, list.text);
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["bk-pages-dead.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>gone</p>",
	});
	assert.equal(dead.status, 201, dead.text);
	const entry = await keep(["proxy_hosts", "access_lists", "dead_hosts"]);
	const hostFile = `/data/public/pages/proxy-host-${host.id}/maintenance.html`;
	const listFile = `/data/public/pages/access-list-${list.body.id}/denied.html`;
	const deadFile = `/data/public/pages/dead-host-${dead.body.id}/404.html`;
	// the files are gone, and a folder of a row that does not exist is left over
	for (const file of [hostFile, listFile, deadFile]) await rm(path.join(api.root, file), { force: true });
	const stale = path.join(api.root, "data/public/pages/proxy-host-9999");
	await mkdir(stale, { recursive: true });
	await writeFile(path.join(stale, "maintenance.html"), "<p>old</p>");
	await restore(entry, ["proxy_hosts", "access_lists", "dead_hosts"]);
	assert.equal(await api.read(hostFile), "<p>m</p>");
	assert.equal(await api.read(listFile), "<p>denied here</p>");
	assert.equal(await api.read(deadFile), "<p>gone</p>");
	assert.equal(await fileExists(api, "data/public/pages/proxy-host-9999/maintenance.html"), false);
});

it("a restore writes no page files for a disabled host, as a disable removes them", async () => {
	const host = await proxy({ npmpro_page_upstream: "custom", npmpro_page_upstream_html: "<p>off</p>" });
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["bk-pages-dead-off.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>dead off</p>",
	});
	assert.equal(dead.status, 201, dead.text);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${host.id}/disable`, {})).status, 200);
	assert.equal((await admin.post(`/nginx/dead-hosts/${dead.body.id}/disable`, {})).status, 200);
	const hostDir = `data/public/pages/proxy-host-${host.id}`;
	const deadDir = `data/public/pages/dead-host-${dead.body.id}`;
	assert.equal(await fileExists(api, hostDir), false);
	assert.equal(await fileExists(api, deadDir), false);
	const entry = await keep(["proxy_hosts", "dead_hosts"]);
	// a folder left over from before the disable is dropped too
	await mkdir(path.join(api.root, hostDir), { recursive: true });
	await writeFile(path.join(api.root, hostDir, "upstream-error.html"), "<p>old</p>");
	await restore(entry, ["proxy_hosts", "dead_hosts"]);
	assert.equal(await fileExists(api, hostDir), false);
	assert.equal(await fileExists(api, deadDir), false);
	assert.equal((await rowOf("proxy_host", host.id)).npmpro_page_upstream_html, "<p>off</p>");
});

it("a restore and a merge leave out a host page that fails the API checks", async () => {
	const host = await proxy({ npmpro_page_maintenance: "custom", npmpro_page_maintenance_html: "<p>m2</p>" });
	await api.db("proxy_host").where({ id: host.id }).update({ npmpro_page_maintenance_html: BAD });
	const entry = await keep(["proxy_hosts"]);
	await restore(entry, ["proxy_hosts"]);
	const restored = await rowOf("proxy_host", host.id);
	assert.equal(restored.npmpro_page_maintenance_html, null);
	assert.equal(await fileExists(api, `data/public/pages/proxy-host-${host.id}/maintenance.html`), false);
	assert.match(await api.read(`/data/nginx/proxy_host/${host.id}.conf`), /\/\.npmpro-page\//u);

	// the merge: the host was deleted, the backup brings it back with the crafted page
	await api.db("proxy_host").where({ id: host.id }).update({ npmpro_page_maintenance_html: BAD });
	const crafted = await keep(["proxy_hosts"]);
	assert.equal((await admin.delete(`/nginx/proxy-hosts/${host.id}`)).status, 200);
	const { token } = (await admin.post(`${BASE}/${crafted.name}/inspect`, {})).body;
	const plan = await admin.post(`${BASE}/restore/${token}/plan`, { mode: "merge", types: ["proxy_hosts"] });
	assert.equal(plan.status, 200, plan.text);
	const merged = await admin.post(`${BASE}/restore/${token}`, {
		mode: "merge",
		types: ["proxy_hosts"],
		plan_hash: plan.body.hash,
	});
	assert.equal(merged.status, 200, merged.text);
	const rows = await api.db("proxy_host").whereNotNull("npmpro_page_maintenance");
	const back = rows.find((row) => row.domain_names.includes(`bk-pages${count}.example.com`));
	assert.ok(back);
	assert.equal(back.npmpro_page_maintenance_html, null);
});

it("an older backup's hand-edited CrowdSec ban page becomes the custom ban page", async () => {
	await admin.put("/settings/landing-pages", { pages: { ban: { choice: "npmpro" } } });
	await mkdir(path.join(api.root, "data/crowdsec"), { recursive: true });
	await writeFile(path.join(api.root, "data/crowdsec/ban.html"), "<p>old hand-edited ban</p>");
	const entry = await keep(["crowdsec_files"]);
	await writeFile(path.join(api.root, "data/crowdsec/ban.html"), "<p>another</p>");
	await restore(entry, ["crowdsec_files"]);
	const view = (await admin.get("/settings/landing-pages")).body;
	assert.equal(view.pages.ban.choice, "custom");
	assert.equal(view.pages.ban.html, "<p>old hand-edited ban</p>");
	assert.equal(await api.read("/data/public/pages/global/ban.html"), "<p>old hand-edited ban</p>");
	assert.equal(await fileExists(api, "data/crowdsec/ban.html.before-pages"), true);
});
