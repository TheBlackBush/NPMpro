import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { runtimeQueue } from "../internal/runtime-queue.js";
import { startApi } from "./support/api.js";
import { addCertificate, fileExists } from "./support/hosts.js";

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

it("writes a host's custom pages with its config and removes them with the host", async () => {
	const made = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-files", { npmpro_page_upstream: "custom", npmpro_page_upstream_html: "<p>mine</p>" }),
	);
	assert.equal(made.status, 201);
	const file = `/data/public/pages/proxy-host-${made.body.id}/upstream-error.html`;
	assert.equal(await api.read(file), "<p>mine</p>");
	assert.match(
		await api.read(`/data/nginx/proxy_host/${made.body.id}.conf`),
		/proxy-host-\d+\/upstream-error\.html/u,
	);
	await admin.put(`/nginx/proxy-hosts/${made.body.id}`, { npmpro_page_upstream: "global" });
	await assert.rejects(api.read(file));
	await admin.put(`/nginx/proxy-hosts/${made.body.id}`, {
		npmpro_page_upstream: "custom",
		npmpro_page_upstream_html: "<p>again</p>",
	});
	assert.equal(await api.read(file), "<p>again</p>");
	await admin.delete(`/nginx/proxy-hosts/${made.body.id}`);
	await assert.rejects(api.read(file));
});

it("writes an access list's denied page and removes it with the list", async () => {
	const list = await admin.post("/nginx/access-lists", {
		name: "pages-files",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>no</p>",
		items: [],
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal(list.status, 201);
	const file = `/data/public/pages/access-list-${list.body.id}/denied.html`;
	assert.equal(await api.read(file), "<p>no</p>");
	await admin.delete(`/nginx/access-lists/${list.body.id}`);
	await assert.rejects(api.read(file));
});

it("the certificate list leaves out the page HTML of the hosts it expands", async () => {
	const certificate = await addCertificate(api, { domain: "pages-cert.example.com" });
	const ca = await addCertificate(api, { provider: "mtls", domain: "pages-ca.example.com" });
	const host = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-cert", {
			certificate_id: certificate,
			npmpro_mtls_certificate_id: ca,
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: "<p>proxy page</p>",
		}),
	);
	assert.equal(host.status, 201, host.text);
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["pages-cert-dead.example.com"],
		certificate_id: certificate,
		npmpro_mtls_certificate_id: ca,
		npmpro_page: "custom",
		npmpro_page_html: "<p>dead page</p>",
	});
	assert.equal(dead.status, 201, dead.text);
	const list = await admin.get("/nginx/certificates?expand=proxy_hosts,dead_hosts,mtls_proxy_hosts,mtls_dead_hosts");
	assert.equal(list.status, 200, list.text);
	const byId = new Map(list.body.map((row) => [row.id, row]));
	assert.deepEqual(
		byId.get(certificate).proxy_hosts.map(({ id }) => id),
		[host.body.id],
	);
	assert.deepEqual(
		byId.get(certificate).dead_hosts.map(({ id }) => id),
		[dead.body.id],
	);
	assert.equal(byId.get(ca).mtls_proxy_hosts.length, 1);
	assert.equal(byId.get(ca).mtls_dead_hosts.length, 1);
	assert.doesNotMatch(list.text, /_html|proxy page|dead page/u);
});

it("a proxy host's answers and audit entries leave out the page HTML of its access lists", async () => {
	const acl = await admin.post("/nginx/access-lists", {
		name: "pages-related",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>list page</p>",
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	assert.equal(acl.status, 201, acl.text);
	const made = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-related", {
			npmpro_access_list_type: "custom",
			npmpro_access_list_ids: [acl.body.id],
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: "<p>own page</p>",
		}),
	);
	assert.equal(made.status, 201, made.text);
	// the host config is still rendered with the list's page
	assert.equal(await api.read(`/data/public/pages/access-list-${acl.body.id}/denied.html`), "<p>list page</p>");
	assert.match(await api.read(`/data/nginx/proxy_host/${made.body.id}.conf`), /access-list-\d+\/denied\.html/u);
	const answers = [
		made,
		await admin.get(`/nginx/proxy-hosts/${made.body.id}`),
		await admin.put(`/nginx/proxy-hosts/${made.body.id}`, { forward_port: 8081 }),
		await admin.post(`/nginx/proxy-hosts/${made.body.id}/disable`, {}),
		await admin.post(`/nginx/proxy-hosts/${made.body.id}/enable`, {}),
	];
	for (const answer of answers) {
		assert.equal(answer.status < 300, true, answer.text);
		assert.equal(answer.body.npmpro_page_upstream_html, "<p>own page</p>");
		assert.deepEqual(
			answer.body.access_lists.map(({ id }) => id),
			[acl.body.id],
		);
		assert.doesNotMatch(answer.text, /list page|npmpro_denied_page_html/u);
	}
	const audit = await admin.get("/audit-log");
	const entries = audit.body.filter((item) => item.object_type === "proxy-host" && item.object_id === made.body.id);
	assert.equal(entries.length, 4);
	for (const entry of entries) {
		assert.equal(entry.meta.access_lists[0].id, acl.body.id);
		assert.doesNotMatch(JSON.stringify(entry.meta), /list page|npmpro_denied_page_html/u);
	}
});

it("the custom pages of every enabled host and access list are written again at start", async () => {
	const { startLandingPages } = await import("../internal/landing-pages.js");
	const enabled = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-start", { npmpro_page_upstream: "custom", npmpro_page_upstream_html: "<p>start</p>" }),
	);
	const disabled = await admin.post(
		"/nginx/proxy-hosts",
		proxy("pages-start-off", { npmpro_page_upstream: "custom", npmpro_page_upstream_html: "<p>off</p>" }),
	);
	assert.equal((await admin.post(`/nginx/proxy-hosts/${disabled.body.id}/disable`, {})).status, 200);
	const dead = await admin.post("/nginx/dead-hosts", {
		domain_names: ["pages-start-dead.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>dead start</p>",
	});
	const acl = await admin.post("/nginx/access-lists", {
		name: "pages-start",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>acl start</p>",
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	// the pages folder is lost
	await rm(path.join(api.root, "data/public/pages"), { recursive: true, force: true });
	const errors = [];
	await startLandingPages({ log: { error: (text) => errors.push(text), info: () => {}, warn: () => {} } });
	assert.deepEqual(errors, []);
	assert.match(await api.read("/data/public/pages/global/404.html"), /Page not found/u);
	assert.equal(
		await api.read(`/data/public/pages/proxy-host-${enabled.body.id}/upstream-error.html`),
		"<p>start</p>",
	);
	assert.equal(await api.read(`/data/public/pages/dead-host-${dead.body.id}/404.html`), "<p>dead start</p>");
	assert.equal(await api.read(`/data/public/pages/access-list-${acl.body.id}/denied.html`), "<p>acl start</p>");
	assert.equal(await fileExists(api, `data/public/pages/proxy-host-${disabled.body.id}`), false);
});

it("a failure writing the custom pages at start is logged and does not throw", async () => {
	const { startLandingPages } = await import("../internal/landing-pages.js");
	const made = await admin.post("/nginx/dead-hosts", {
		domain_names: ["pages-start-fail.example.com"],
		npmpro_page: "custom",
		npmpro_page_html: "<p>x</p>",
	});
	assert.equal(made.status, 201, made.text);
	const folder = path.join(api.root, `data/public/pages/dead-host-${made.body.id}`);
	await rm(folder, { recursive: true, force: true });
	await writeFile(folder, "not a folder");
	const errors = [];
	try {
		await startLandingPages({ log: { error: (text) => errors.push(text), info: () => {}, warn: () => {} } });
		assert.equal(errors.length, 1);
		assert.match(errors[0], /could not write the custom pages of the dead_host rows/u);
	} finally {
		await rm(folder, { force: true });
	}
	await startLandingPages();
	assert.equal(await api.read(`/data/public/pages/dead-host-${made.body.id}/404.html`), "<p>x</p>");
});

it("an access list's page write waits for the runtime queue", async () => {
	const { promise: gate, resolve: release } = Promise.withResolvers();
	const held = runtimeQueue(() => gate);
	const saving = admin.post("/nginx/access-lists", {
		name: "pages-queue",
		npmpro_denied_page: "custom",
		npmpro_denied_page_html: "<p>queued</p>",
		clients: [{ address: "10.0.0.0/8", directive: "allow" }],
	});
	let settled = false;
	saving.then(() => {
		settled = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(settled, false);
	const rows = await api.db("access_list").where({ name: "pages-queue" });
	assert.equal(rows.length, 1);
	assert.equal(await fileExists(api, `data/public/pages/access-list-${rows[0].id}`), false);
	release();
	await held;
	const done = await saving;
	assert.equal(done.status, 201, done.text);
	assert.equal(await api.read(`/data/public/pages/access-list-${done.body.id}/denied.html`), "<p>queued</p>");
});
