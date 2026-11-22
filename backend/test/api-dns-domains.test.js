import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { countRows } from "./support/hosts.js";

const BASE = "/nginx/dns-domains";
const TOKEN = "cf-token-SECRET-domains-1234567890";
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];

let api;
let admin;
let credentials = 0;

const credential = async (session = admin, provider = "cloudflare") => {
	credentials += 1;
	const done = await session.post("/nginx/dns-credentials", {
		name: `Credential ${credentials}`,
		provider,
		fields: [{ key: "dns_cloudflare_api_token", value: TOKEN }],
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const add = (credentialId, names, session = admin, extra = {}) =>
	session.post(BASE, { dns_credential_id: credentialId, names, ...extra });
const auditRows = (action) => api.db("audit_log").where({ object_type: "dns-domain", action }).orderBy("id", "desc");

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("adds a batch: 201, normalized, typed by default, an audit entry with the names and the credential, never a value", async () => {
	const c = await credential();
	const done = await add(c.id, ["Example.COM.", "bücher.de"]);
	assert.equal(done.status, 201, done.text);
	assert.deepEqual(
		done.body.map((row) => row.name),
		["example.com", "xn--bcher-kva.de"],
	);
	for (const row of done.body) {
		assert.equal(row.source, "typed");
		assert.equal(row.dns_credential_id, c.id);
	}
	const [entry] = await auditRows("created");
	assert.equal(entry.object_id, done.body[0].id);
	const meta = JSON.parse(entry.meta);
	assert.deepEqual(meta.names, ["example.com", "xn--bcher-kva.de"]);
	assert.equal(meta.credential_name, c.name);
	assert.equal(meta.provider, "cloudflare");
	assert.equal(meta.dns_credential_id, c.id);
	assert.equal(JSON.stringify(done.body).includes(TOKEN), false);
	assert.equal(entry.meta.includes(TOKEN), false);
	const fetched = await add(c.id, ["fetched.example"], admin, { source: "fetched" });
	assert.equal(fetched.status, 201, fetched.text);
	assert.equal(fetched.body[0].source, "fetched");
});

it("refuses the whole batch when one name is on another credential of the same owner", async () => {
	const a = await credential();
	const b = await credential();
	assert.equal((await add(a.id, ["taken.example"])).status, 201);
	const rows = await countRows(api, "npmpro_dns_domain");
	const refused = await add(b.id, ["new.example", "taken.example"]);
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.dns-domain-taken");
	assert.deepEqual(refused.body.error.message_values, { domain: "taken.example", credential: a.name });
	assert.equal(await countRows(api, "npmpro_dns_domain"), rows);
	assert.equal(await api.db("npmpro_dns_domain").where({ name: "new.example" }).first(), undefined);
});

it("lets another owner add the same name", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const mine = await credential(own);
	const theirs = await credential();
	assert.equal((await add(theirs.id, ["shared.example"])).status, 201);
	const done = await add(mine.id, ["shared.example"], own);
	assert.equal(done.status, 201, done.text);
	assert.equal(done.body[0].name, "shared.example");
});

it("refuses a name that is no DNS domain, and stores nothing of its batch", async () => {
	const c = await credential();
	const rows = await countRows(api, "npmpro_dns_domain");
	for (const [names, key, domain] of [
		[["*.example.com"], "error.dns-domain-wildcard", "*.example.com"],
		[["localhost"], "error.dns-domain-one-label", "localhost"],
		[["1.2.3.4"], "error.dns-domain-invalid", "1.2.3.4"],
		[["ok.example", "bad/name"], "error.dns-domain-invalid", "bad/name"],
	]) {
		const refused = await add(c.id, names);
		assert.equal(refused.status, 400, refused.text);
		assert.equal(refused.body.error.message_i18n, key, JSON.stringify(names));
		assert.equal(refused.body.error.message_values.domain, domain);
	}
	assert.equal(await countRows(api, "npmpro_dns_domain"), rows);
});

it("skips a name the credential already has, as typed or in another case", async () => {
	const c = await credential();
	assert.equal((await add(c.id, ["dup.example"])).status, 201);
	const again = await add(c.id, ["DUP.example", "more.example"]);
	assert.equal(again.status, 201, again.text);
	assert.deepEqual(
		again.body.map((row) => row.name),
		["more.example"],
	);
	assert.equal((await api.db("npmpro_dns_domain").where({ name: "dup.example" })).length, 1);
});

it("refuses a body the schema refuses", async () => {
	const c = await credential();
	const rows = await countRows(api, "npmpro_dns_domain");
	const many = Array.from({ length: 101 }, (_, n) => `n${n}.example`);
	for (const body of [
		{ dns_credential_id: c.id },
		{ dns_credential_id: c.id, names: [] },
		{ dns_credential_id: c.id, names: many },
		{ dns_credential_id: c.id, names: [""] },
		{ dns_credential_id: c.id, names: ["a.example"], extra: 1 },
		{ dns_credential_id: c.id, names: ["a.example"], source: "other" },
		{ dns_credential_id: 0, names: ["a.example"] },
	]) {
		const refused = await admin.post(BASE, body);
		assert.equal(refused.status, 400, JSON.stringify(body).slice(0, 80));
	}
	assert.equal(await countRows(api, "npmpro_dns_domain"), rows);
});

it("lists by name, searches, expands the credential and its owner without values", async () => {
	const a = await credential();
	const b = await credential();
	assert.equal((await add(a.id, ["zz-lab.example", "aa-lab.example"])).status, 201);
	assert.equal((await add(b.id, ["mm-other.example"])).status, 201);
	const all = await admin.get(BASE);
	assert.equal(all.status, 200);
	const listed = all.body.map((entry) => entry.name);
	assert.deepEqual(
		listed,
		[...listed].sort((x, y) => x.localeCompare(y)),
	);
	const found = await admin.get(`${BASE}?query=lab`);
	assert.deepEqual(
		found.body.map((entry) => entry.name),
		["aa-lab.example", "zz-lab.example"],
	);
	const expanded = await admin.get(`${BASE}?expand=credential&query=mm-other`);
	assert.equal(expanded.status, 200, expanded.text);
	const [row] = expanded.body;
	assert.equal(row.credential.id, b.id);
	assert.equal(row.credential.name, b.name);
	assert.equal(row.credential.provider, "cloudflare");
	assert.equal(typeof row.credential.owner.name, "string");
	assert.equal(expanded.text.includes(TOKEN), false);
	assert.equal("values" in row.credential, false);
});

it("moves a domain to another credential of the same owner", async () => {
	const a = await credential();
	const b = await credential();
	const [domain] = (await add(a.id, ["move.example"])).body;
	const moved = await admin.put(`${BASE}/${domain.id}`, { dns_credential_id: b.id });
	assert.equal(moved.status, 200, moved.text);
	assert.equal(moved.body.dns_credential_id, b.id);
	const [entry] = await auditRows("updated");
	const meta = JSON.parse(entry.meta);
	assert.equal(meta.from.dns_credential_id, a.id);
	assert.equal(meta.to.dns_credential_id, b.id);
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const foreign = await credential(own);
	const refused = await admin.put(`${BASE}/${domain.id}`, { dns_credential_id: foreign.id });
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_i18n, "error.dns-domain-other-owner");
	assert.equal((await api.db("npmpro_dns_domain").where({ id: domain.id }).first()).dns_credential_id, b.id);
});

it("deletes a domain and audits it", async () => {
	const c = await credential();
	const [domain] = (await add(c.id, ["gone.example"])).body;
	const done = await admin.delete(`${BASE}/${domain.id}`);
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.name, "gone.example");
	assert.equal((await admin.get(`${BASE}/${domain.id}`)).status, 404);
	const [entry] = await auditRows("deleted");
	assert.deepEqual(JSON.parse(entry.meta).names, ["gone.example"]);
});

it("a user limited to their own items never sees or touches another owner's domains", async () => {
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	const mine = await credential(own);
	const foreign = await credential();
	const [theirs] = (await add(foreign.id, ["theirs.example"])).body;
	const [ownDomain] = (await add(mine.id, ["mine.example"], own)).body;
	const listed = await own.get(BASE);
	assert.equal(listed.status, 200);
	assert.deepEqual(
		listed.body.map((row) => row.id),
		[ownDomain.id],
	);
	const rows = await countRows(api, "npmpro_dns_domain");
	assert.equal((await own.get(`${BASE}/${theirs.id}`)).status, 404);
	assert.equal((await own.put(`${BASE}/${theirs.id}`, { dns_credential_id: mine.id })).status, 404);
	assert.equal((await own.delete(`${BASE}/${theirs.id}`)).status, 404);
	assert.equal((await add(foreign.id, ["x.example"], own)).status, 404);
	assert.equal((await own.put(`${BASE}/${ownDomain.id}`, { dns_credential_id: foreign.id })).status, 404);
	assert.equal(await countRows(api, "npmpro_dns_domain"), rows);
	assert.equal((await api.db("npmpro_dns_domain").where({ id: theirs.id }).first()).dns_credential_id, foreign.id);
	assert.equal((await api.db("npmpro_dns_domain").where({ id: ownDomain.id }).first()).dns_credential_id, mine.id);
});

it("refuses without the permission", async () => {
	const c = await credential();
	const [domain] = (await add(c.id, ["perm.example"])).body;
	const hidden = await api.limited({ visibility: "all", certificates: "hidden" });
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	const body = { dns_credential_id: c.id, names: ["denied.example"] };
	const writes = [
		["post", BASE, body],
		["put", `${BASE}/${domain.id}`, { dns_credential_id: c.id }],
		["delete", `${BASE}/${domain.id}`],
	];
	const rows = await countRows(api, "npmpro_dns_domain");
	for (const [method, url, payload] of [["get", BASE], ["get", `${BASE}/${domain.id}`], ...writes]) {
		assert.equal((await hidden[method](url, payload)).status, 403, `hidden ${method} ${url}`);
	}
	assert.equal((await viewer.get(BASE)).status, 200);
	assert.equal((await viewer.get(`${BASE}/${domain.id}`)).status, 200);
	for (const [method, url, payload] of writes) {
		assert.equal((await viewer[method](url, payload)).status, 403, `view ${method} ${url}`);
	}
	const made = await admin.post("/users/me/api-tokens", {
		name: "domains",
		permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === "certificates" ? "view" : "hidden"])),
	});
	assert.equal(made.status, 201, made.text);
	const headers = { authorization: `Bearer ${made.body.token}` };
	assert.equal((await api.client().get(BASE, { headers })).status, 200);
	assert.equal((await api.client().post(BASE, body, { headers })).status, 403);

	assert.equal(await countRows(api, "npmpro_dns_domain"), rows);
});

it("answers 401 without a session on every route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", BASE],
		["post", BASE, { dns_credential_id: 1, names: ["a.example"] }],
		["get", `${BASE}/1`],
		["put", `${BASE}/1`, { dns_credential_id: 1 }],
		["delete", `${BASE}/1`],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
});

it("documents the status the create answers with", async () => {
	const schema = await admin.get("/schema");
	assert.equal(schema.status, 200);
	const responses = schema.body.paths["/nginx/dns-domains"].post.responses;
	const c = await credential();
	const done = await add(c.id, ["documented.example"]);
	assert.equal(done.status, 201);
	assert.ok(responses["201"], `the schema lists ${Object.keys(responses).join(", ")} but the route answers 201`);
});

it("two concurrent adds of one name to two credentials of one owner: one 201, one 400 taken", async () => {
	const a = await credential();
	const b = await credential();
	const [first, second] = await Promise.all([add(a.id, ["race.example"]), add(b.id, ["race.example"])]);
	assert.deepEqual(
		[first.status, second.status].sort((x, y) => x - y),
		[201, 400],
	);
	const refused = first.status === 400 ? first : second;
	assert.equal(refused.body.error.message_i18n, "error.dns-domain-taken");
	assert.equal((await api.db("npmpro_dns_domain").where({ name: "race.example" })).length, 1);
});

it("names every credential of a refused batch, or the first and the count", async () => {
	const a = await credential();
	const b = await credential();
	const c = await credential();
	assert.equal((await add(a.id, ["one-t.example"])).status, 201);
	assert.equal((await add(b.id, ["two-t.example"])).status, 201);
	const refused = await add(c.id, ["one-t.example", "two-t.example"]);
	assert.equal(refused.status, 400);
	assert.equal(refused.body.error.message_values.domain, "one-t.example, two-t.example");
	assert.equal(refused.body.error.message_values.credential, `${a.name} and 1 more`);
});

it("searches without case and treats % and _ as plain characters", async () => {
	const c = await credential();
	assert.equal((await add(c.id, ["under-score.example", "underXscore.example", "pct.example"])).status, 201);
	const lower = await admin.get(`${BASE}?query=PCT`);
	assert.deepEqual(
		lower.body.map((entry) => entry.name),
		["pct.example"],
	);
	const underscore = await admin.get(`${BASE}?query=${encodeURIComponent("r_s")}`);
	assert.deepEqual(underscore.body, []);
	assert.deepEqual((await admin.get(`${BASE}?query=${encodeURIComponent("%")}`)).body, []);
});

it("refuses a bearer token without Allow delete on DELETE", async () => {
	const c = await credential();
	const [domain] = (await add(c.id, ["nodelete.example"])).body;
	const made = await admin.post("/users/me/api-tokens", {
		name: "no-delete",
		permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === "certificates" ? "manage" : "hidden"])),
	});
	assert.equal(made.status, 201, made.text);
	const headers = { authorization: `Bearer ${made.body.token}` };
	assert.equal((await api.client().delete(`${BASE}/${domain.id}`, { headers })).status, 403);
	assert.ok(await api.db("npmpro_dns_domain").where({ id: domain.id }).first());
});
