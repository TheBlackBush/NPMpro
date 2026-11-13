import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const INCLUDE_REFUSED = /include is not allowed/u;

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

const PAGE = '<!DOCTYPE html><p>soon, <!--# echo var="host" --></p>';
const proxy = (name, extra = {}) => ({
	domain_names: [`${name}.example.com`],
	forward_host: "127.0.0.1",
	forward_port: 8080,
	...extra,
});

it("a new proxy host gets the page defaults, and the upstream error page on", async () => {
	const res = await admin.post("/nginx/proxy-hosts", proxy("pages-defaults"));
	assert.equal(res.status, 201);
	assert.equal(res.body.npmpro_maintenance, false);
	assert.equal(res.body.npmpro_page_not_found, "upstream");
	assert.equal(res.body.npmpro_page_upstream, "global");
	assert.equal(res.body.npmpro_page_maintenance, "global");
	assert.equal(res.body.npmpro_page_upstream_html, "");
});

it("a custom page is stored, checked, shown by the single GET and left out of the list", async () => {
	const refused = await admin.post("/nginx/proxy-hosts", proxy("pages-refused", { npmpro_page_upstream: "custom" }));
	assert.equal(refused.status, 400);
	const ssi = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-ssi", {
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: '<!--# include virtual="/" -->',
		}),
	);
	assert.equal(ssi.status, 400);
	assert.match(ssi.text, INCLUDE_REFUSED);

	const made = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-custom", {
			npmpro_maintenance: true,
			npmpro_page_maintenance: "custom",
			npmpro_page_maintenance_html: PAGE,
		}),
	);
	assert.equal(made.status, 201);
	assert.equal(made.body.npmpro_page_maintenance_html, PAGE);
	const one = await admin.get(`/nginx/proxy-hosts/${made.body.id}`);
	assert.equal(one.body.npmpro_page_maintenance_html, PAGE);
	const list = await admin.get("/nginx/proxy-hosts");
	const row = list.body.find((host) => host.id === made.body.id);
	assert.equal(row.npmpro_page_maintenance, "custom");
	assert.ok(!Object.hasOwn(row, "npmpro_page_maintenance_html"));
});

it("keeps a page untrimmed, takes a 1 MiB page and the audit log stores only its size", async () => {
	const big = `<p>${"a".repeat(1024 * 1024 - 8)}</p> `;
	const made = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-big", { npmpro_page_upstream: "custom", npmpro_page_upstream_html: big }),
	);
	assert.equal(made.status, 201);
	assert.equal(made.body.npmpro_page_upstream_html, big);
	const audit = await admin.get("/audit-log");
	const entry = audit.body.find((item) => item.object_type === "proxy-host" && item.object_id === made.body.id);
	assert.equal(entry.meta.npmpro_page_upstream_html, `(${Buffer.byteLength(big)} bytes)`);
	const tooBig = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-too-big", {
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: "a".repeat(1024 * 1024 + 1),
		}),
	);
	assert.equal(tooBig.status, 400);
});

it("404 hosts and access lists have their page field", async () => {
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["pages-dead.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>gone</p>",
	});
	assert.equal(dead.status, 201);
	assert.equal(dead.body.npmpro_page, "custom");
	const list = await admin.post("/nginx/access-lists", {
		name: "pages-acl",
		npmpro_denied_page: "plain",
		items: [],
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal(list.status, 201);
	assert.equal(list.body.npmpro_denied_page, "plain");
	const bad = await admin.put(`/nginx/access-lists/${list.body.id}`, { npmpro_denied_page: "custom" });
	assert.equal(bad.status, 400);
});

it("an empty page with the custom choice keeps the saved page, another choice clears it", async () => {
	const made = await admin.post("/nginx/dead-hosts", {
		domain_names: ["pages-keep.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>kept</p>",
	});
	assert.equal(made.status, 201);
	const kept = await admin.put(`/nginx/dead-hosts/${made.body.id}`, { npmpro_page: "custom", npmpro_page_html: "" });
	assert.equal(kept.status, 200);
	assert.equal(kept.body.npmpro_page_html, "<p>kept</p>");
	const cleared = await admin.put(`/nginx/dead-hosts/${made.body.id}`, {
		npmpro_page: "npmpro",
		npmpro_page_html: "",
	});
	assert.equal(cleared.status, 200);
	assert.equal(cleared.body.npmpro_page_html, "");
	const back = await admin.put(`/nginx/dead-hosts/${made.body.id}`, { npmpro_page: "custom" });
	assert.equal(back.status, 400);
});

it("access list pages are stored and left out of the list", async () => {
	const made = await admin.post("/nginx/access-lists", {
		name: "pages-acl-custom",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>no</p>",
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal(made.status, 201);
	assert.equal(made.body.npmpro_denied_page_html, "<p>no</p>");
	const list = await admin.get("/nginx/access-lists");
	const row = list.body.find((item) => item.id === made.body.id);
	assert.equal(row.npmpro_denied_page, "custom");
	assert.ok(!Object.hasOwn(row, "npmpro_denied_page_html"));
	const updated = await admin.put(`/nginx/access-lists/${made.body.id}`, { npmpro_denied_page_html: "<p>new</p>" });
	assert.equal(updated.status, 200);
	assert.equal(updated.body.npmpro_denied_page_html, "<p>new</p>");
});
