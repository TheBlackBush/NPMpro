import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

const URL = "/nginx/ddns/suggestions";
const RECORDS = "/nginx/ddns-records";
const STAMP = "2026-01-01 00:00:00";
const HOST_COLUMNS = {
	proxy_host: { forward_host: "10.0.0.1", forward_port: 80, forward_scheme: "http" },
	redirection_host: { forward_domain_name: "t.example.org" },
	dead_host: {},
};

let api;
let admin;
let credentials = 0;

const credential = async (session, domains, body = {}) => {
	credentials += 1;
	const done = await session.post("/nginx/dns-credentials", {
		name: `Credential ${credentials}`,
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-suggestions-1234567890" }],
		...body,
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	if (domains.length > 0) {
		const added = await session.post("/nginx/dns-domains", { dns_credential_id: done.body.id, names: domains });
		if (added.status !== 201) throw new Error(`domains create answered ${added.status}: ${added.text}`);
	}
	return done.body;
};
const host = (table, owner, names) =>
	api.db(table).insert({
		owner_user_id: owner,
		created_on: STAMP,
		modified_on: STAMP,
		domain_names: JSON.stringify(names),
		meta: "{}",
		...HOST_COLUMNS[table],
	});
const clear = async () => {
	for (const table of ["npmpro_ddns_record", "npmpro_dns_domain", "npmpro_dns_credential"]) await api.db(table).del();
	for (const table of Object.keys(HOST_COLUMNS)) await api.db(table).del();
};
const namesOf = (done) => done.body.map((entry) => entry.name);

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("suggests the host names under a zone with the credential and the longest zone, none for other names", async () => {
	await clear();
	const wide = await credential(admin, ["example.com"]);
	const narrow = await credential(admin, ["lab.example.com"]);
	await host("proxy_host", 1, ["App.Example.com", "x.lab.example.com", "*.example.com", "~^re.*$", "other.org"]);
	await host("redirection_host", 1, ["old.example.com", "EXAMPLE.com"]);
	await host("dead_host", 1, ["gone.example.com"]);
	const done = await admin.get(URL);
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body, [
		{ name: "app.example.com", zone: "example.com", dns_credential_id: wide.id, credential_name: wide.name },
		{ name: "example.com", zone: "example.com", dns_credential_id: wide.id, credential_name: wide.name },
		{ name: "gone.example.com", zone: "example.com", dns_credential_id: wide.id, credential_name: wide.name },
		{ name: "old.example.com", zone: "example.com", dns_credential_id: wide.id, credential_name: wide.name },
		{
			name: "x.lab.example.com",
			zone: "lab.example.com",
			dns_credential_id: narrow.id,
			credential_name: narrow.name,
		},
	]);
});

it("leaves out a name a record already has, whatever its type", async () => {
	await clear();
	const made = await credential(admin, ["example.com"]);
	await host("proxy_host", 1, ["kept.example.com", "free.example.com", "alias.example.com"]);
	const first = await admin.post(RECORDS, { name: "kept.example.com", dns_credential_id: made.id });
	assert.equal(first.status, 201, first.text);
	const second = await admin.post(RECORDS, {
		name: "alias.example.com",
		dns_credential_id: made.id,
		kind: "alias",
		target: "home.example.net",
	});
	assert.equal(second.status, 201, second.text);
	assert.deepEqual(namesOf(await admin.get(URL)), ["free.example.com"]);
});

it("answers nothing without a credential with zones, and none for a zoneless or DNS-only provider", async () => {
	await clear();
	await host("proxy_host", 1, ["a.example.com"]);
	assert.deepEqual((await admin.get(URL)).body, []);
	const duck = await credential(admin, [], {
		provider: "duckdns",
		fields: [{ key: "dns_duckdns_token", value: "duck-token-suggestions" }],
	});
	await api.db("npmpro_dns_domain").insert({
		dns_credential_id: duck.id,
		name: "example.com",
		source: "manual",
		created_on: STAMP,
		modified_on: STAMP,
	});
	assert.deepEqual((await admin.get(URL)).body, []);
});

it("applies the visibility of credentials and hosts and the host type permissions", async () => {
	await clear();
	const own = await api.limited({
		visibility: "user",
		certificates: "manage",
		proxy_hosts: "view",
		access_lists: "view",
		dead_hosts: "view",
	});
	await credential(admin, ["admin.example"]);
	const mine = await credential(own, ["mine.example"]);
	await host("proxy_host", 1, ["a.admin.example", "a.mine.example"]);
	await host("proxy_host", own.user.id, ["b.mine.example", "b.admin.example"]);
	await host("dead_host", own.user.id, ["c.mine.example"]);
	await host("redirection_host", own.user.id, ["d.mine.example"]);
	const done = await own.get(URL);
	assert.equal(done.status, 200, done.text);
	// own hosts only, own zones only; redirection hosts are not viewable
	assert.deepEqual(done.body, [
		{ name: "b.mine.example", zone: "mine.example", dns_credential_id: mine.id, credential_name: mine.name },
		{ name: "c.mine.example", zone: "mine.example", dns_credential_id: mine.id, credential_name: mine.name },
	]);
	const all = await admin.get(URL);
	assert.deepEqual(namesOf(all), [
		"a.admin.example",
		"a.mine.example",
		"b.admin.example",
		"b.mine.example",
		"c.mine.example",
		"d.mine.example",
	]);
});

it("needs the view permission of certificates and stops at 100 names", async () => {
	await clear();
	const hidden = await api.limited({ visibility: "all", certificates: "hidden" });
	assert.equal((await hidden.get(URL)).status, 403);
	await credential(admin, ["many.example"]);
	const names = Array.from({ length: 120 }, (_, i) => `h${String(i).padStart(3, "0")}.many.example`);
	await host("proxy_host", 1, names);
	const done = await admin.get(URL);
	assert.equal(done.body.length, 100);
	assert.equal(done.body[99].name, "h099.many.example");
});

it("reads a trailing-dot host name as the name without the dot", async () => {
	await clear();
	const made = await credential(admin, ["example.com"]);
	await host("proxy_host", 1, ["dotted.example.com."]);
	assert.deepEqual((await admin.get(URL)).body, [
		{ name: "dotted.example.com", zone: "example.com", dns_credential_id: made.id, credential_name: made.name },
	]);
});

it("takes the first credential (lowest zone row) when two credentials hold the same zone", async () => {
	await clear();
	const own = await api.limited({
		visibility: "user",
		certificates: "manage",
		proxy_hosts: "view",
		access_lists: "view",
	});
	const first = await credential(admin, ["tie.example"]);
	await credential(own, ["tie.example"]);
	await host("proxy_host", 1, ["a.tie.example"]);
	const done = await admin.get(URL);
	assert.deepEqual(done.body, [
		{ name: "a.tie.example", zone: "tie.example", dns_credential_id: first.id, credential_name: first.name },
	]);
});
