import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const URL = "/nginx/dns-domains/suggestions";
const TOKEN = "cf-token-suggestions-1234567890";
const STAMP = "2026-01-01 00:00:00";

let api;
let admin;
let credentials = 0;

const credential = async (session, domains) => {
	credentials += 1;
	const done = await session.post("/nginx/dns-credentials", {
		name: `Credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	const added = await session.post("/nginx/dns-domains", { dns_credential_id: done.body.id, names: domains });
	if (added.status !== 201) throw new Error(`domains create answered ${added.status}: ${added.text}`);
	return done.body;
};
const insert = (table, owner, names, extra = {}) =>
	api.db(table).insert({
		owner_user_id: owner,
		created_on: STAMP,
		modified_on: STAMP,
		domain_names: JSON.stringify(names),
		...extra,
	});
const HOST_COLUMNS = {
	proxy_host: { meta: "{}", forward_host: "10.0.0.1", forward_port: 80, forward_scheme: "http" },
	redirection_host: { meta: "{}", forward_domain_name: "t.example.org" },
	dead_host: { meta: "{}" },
};
const insertHost = (table, owner, names) => insert(table, owner, names, HOST_COLUMNS[table]);
const insertCertificate = (owner, names, extra = {}) =>
	insert("certificate", owner, names, {
		provider: "other",
		nice_name: "Certificate",
		meta: "{}",
		expires_on: "2099-01-01 00:00:00",
		...extra,
	});
const clearNames = async () => {
	for (const table of ["proxy_host", "redirection_host", "dead_host", "certificate"]) {
		await api.db(table).del();
	}
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("answers the zones of the visible credentials with their credential and owner", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const a = await credential(admin, ["one.example", "two.example"]);
	const b = await credential(own, ["mine.example"]);
	const all = await admin.get(URL);
	assert.equal(all.status, 200, all.text);
	assert.deepEqual(
		all.body.zones.map((zone) => zone.name),
		["mine.example", "one.example", "two.example"],
	);
	const mine = all.body.zones.find((zone) => zone.name === "mine.example");
	assert.deepEqual(mine, {
		name: "mine.example",
		dns_credential_id: b.id,
		credential_name: b.name,
		provider: "cloudflare",
		owner_user_id: own.user.id,
		owner_name: own.user.name,
	});
	assert.equal(all.body.zones.find((zone) => zone.name === "one.example").dns_credential_id, a.id);
	assert.equal(all.body.zones.find((zone) => zone.name === "one.example").owner_name, "Admin");
	const limited = await own.get(URL);
	assert.deepEqual(
		limited.body.zones.map((zone) => zone.name),
		["mine.example"],
	);
});

it("holds no credential secret", async () => {
	await credential(admin, ["secret-check.example"]);
	const done = await admin.get(URL);
	assert.equal(done.text.includes(TOKEN), false);
	assert.equal(done.text.includes("values"), false);
});

it("lists the names of hosts and certificates once, sorted, with their source", async () => {
	await clearNames();
	await insertHost("proxy_host", 1, ["app.example.com", "www.example.com"]);
	await insertHost("redirection_host", 1, ["old.example.com"]);
	await insertHost("dead_host", 1, ["gone.example.com"]);
	await insertCertificate(1, ["App.Example.com", "*.example.com", "*.Bücher.de", "not a name"]);
	const done = await admin.get(URL);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.names, [
		{ name: "*.example.com", source: "certificate" },
		{ name: "*.xn--bcher-kva.de", source: "certificate" },
		{ name: "app.example.com", source: "proxy_host" },
		{ name: "gone.example.com", source: "dead_host" },
		{ name: "old.example.com", source: "redirection_host" },
		{ name: "www.example.com", source: "proxy_host" },
	]);
});

it("filters by host type permission", async () => {
	await clearNames();
	await insertHost("proxy_host", 1, ["proxy.example.com"]);
	await insertHost("redirection_host", 1, ["redirect.example.com"]);
	await insertCertificate(1, ["cert.example.com"]);
	await insertHost("dead_host", 1, ["dead.example.com"]);
	const user = await api.limited({
		visibility: "all",
		proxy_hosts: "view",
		access_lists: "view",
		redirection_hosts: "hidden",
		dead_hosts: "hidden",
		certificates: "view",
	});
	const done = await user.get(URL);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.names, [
		{ name: "cert.example.com", source: "certificate" },
		{ name: "proxy.example.com", source: "proxy_host" },
	]);
	assert.equal(done.text.includes("redirect.example.com"), false);
	const noProxy = await api.limited({
		visibility: "all",
		proxy_hosts: "hidden",
		access_lists: "hidden",
		redirection_hosts: "view",
		dead_hosts: "view",
		certificates: "view",
	});
	const other = await noProxy.get(URL);
	assert.deepEqual(
		other.body.names.map((entry) => entry.name),
		["cert.example.com", "dead.example.com", "redirect.example.com"],
	);
	assert.equal(other.text.includes("proxy.example.com"), false);
});

it("applies visibility to the names", async () => {
	await clearNames();
	const own = await api.limited({
		visibility: "user",
		proxy_hosts: "view",
		access_lists: "view",
		redirection_hosts: "view",
		dead_hosts: "view",
		certificates: "view",
	});
	await insertHost("proxy_host", own.user.id, ["mine.example.com"]);
	await insertHost("redirection_host", own.user.id, ["mine-redirect.example.com"]);
	await insertHost("dead_host", own.user.id, ["mine-404.example.com"]);
	await insertHost("proxy_host", 1, ["theirs.example.com"]);
	await insertHost("redirection_host", 1, ["theirs-redirect.example.com"]);
	await insertHost("dead_host", 1, ["theirs-404.example.com"]);
	await insertCertificate(own.user.id, ["mine-cert.example.com"]);
	await insertCertificate(1, ["theirs-cert.example.com"]);
	const done = await own.get(URL);
	assert.deepEqual(
		done.body.names.map((entry) => entry.name),
		["mine-404.example.com", "mine-cert.example.com", "mine-redirect.example.com", "mine.example.com"],
	);
});

it("leaves out regular expression names and stops at 2000", async () => {
	await clearNames();
	await insertHost("proxy_host", 1, ["~^api\\d+\\.example\\.com$", "plain.example.com"]);
	const first = await admin.get(URL);
	assert.deepEqual(first.body.names, [{ name: "plain.example.com", source: "proxy_host" }]);
	const many = Array.from({ length: 2100 }, (_, index) => `n${String(index).padStart(4, "0")}.example.com`);
	await insertCertificate(1, many.slice(0, 1100));
	await insertHost("proxy_host", 1, many.slice(1100));
	const done = await admin.get(URL);
	assert.equal(done.body.names.length, 2000);
});

it("refuses a user without certificates view", async () => {
	const user = await api.limited({ visibility: "all", certificates: "hidden", proxy_hosts: "hidden" });
	const done = await user.get(URL);
	assert.equal(done.status, 403);
});
