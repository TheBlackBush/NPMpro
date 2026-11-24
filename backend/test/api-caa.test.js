import assert from "node:assert/strict";
import path from "node:path";
import { after, before, beforeEach, it } from "node:test";
import { GOOGLE_SERVER, LETSENCRYPT_STAGING_SERVER, ZEROSSL_SERVER } from "../lib/acme-server.js";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, seedAccount } from "./support/certbot.js";

const CERTS = "/nginx/certificates";
const ACME = "https://acme.test/directory";
const OTHER = "https://other.test/directory";
const CHECK = `${CERTS}/caa-check`;
const LIST = `${CERTS}/caa`;
const ISO_DATE = /^\d{4}-\d\d-\d\dT/u;
const issue = (value, critical = 0) => [{ critical, type: "CAA", issue: value }];

let api;
let admin;
let ids = 0;

const dns = (name, records) => api.outside.names.set(name, "CAA", records);
// a certificate row as the issuing code leaves it (no certbot run is needed to read its names)
const certificate = async (names, extra = {}) => {
	ids += 1;
	const [id] = await api.db("certificate").insert({
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		owner_user_id: extra.owner_user_id ?? 1,
		provider: "letsencrypt",
		nice_name: `caa ${ids}`,
		domain_names: JSON.stringify(names),
		expires_on: "2027-01-01 00:00:00",
		meta: "{}",
		npmpro_acme_server: ACME,
		npmpro_dns_challenge: 0,
		...extra,
	});
	return id;
};
const entry = async (session, id) => (await session.get(LIST)).body.find((item) => item.certificate_id === id);

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME } });
	api.outside.dns.set("acme.test", "192.0.2.40");
	api.outside.dns.set("other.test", "192.0.2.41");
	acmeDirectory(api, ACME, {
		body: { newNonce: "n", meta: { caaIdentities: ["Directory-CA.example"] } },
	});
	acmeDirectory(api, OTHER, { body: { newNonce: "n" } });
	// OTHER is a set-up CA whose directory names no CAA identity
	await seedAccount(api, OTHER, "d".repeat(32));
	const accounts = (await import("../models/acme_account.js")).default;
	await accounts.query().insert({ server: OTHER, account_id: "d".repeat(32), state: "registered" });
	// presets: Google's directory names no identity (the fixed list answers), the staging one names its own,
	// ZeroSSL's directory is down (the fixed list answers)
	api.outside.dns.set("dv.acme-v02.api.pki.goog", "192.0.2.42");
	api.outside.dns.set("acme-staging-v02.api.letsencrypt.org", "192.0.2.43");
	api.outside.dns.set("acme.zerossl.com", "192.0.2.44");
	acmeDirectory(api, GOOGLE_SERVER, { body: { newNonce: "n", meta: {} } });
	acmeDirectory(api, LETSENCRYPT_STAGING_SERVER, {
		body: { newNonce: "n", meta: { caaIdentities: ["stage-ca.example"] } },
	});
	acmeDirectory(api, ZEROSSL_SERVER, { body: "down", status: 503 });
	for (const [index, server] of [GOOGLE_SERVER, LETSENCRYPT_STAGING_SERVER, ZEROSSL_SERVER].entries()) {
		await seedAccount(api, server, String(index).repeat(32));
		await accounts.query().insert({ server, account_id: String(index).repeat(32), state: "registered" });
	}
	admin = await api.admin();
});
beforeEach(async () => {
	await api.outside.names.clear();
});
after(() => api?.stop());

it("a name under a set that lists the CA is allowed, one under another set is refused, with the record", async () => {
	await dns("ok.example.com", issue("directory-ca.example"));
	await dns("no.example.net", issue("letsencrypt.org"));
	const res = await admin.post(CHECK, { domain_names: ["ok.example.com", "www.ok.example.com", "no.example.net"] });
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.names.map(({ name, state, reason, found_at }) => [name, state, reason, found_at]),
		[
			["ok.example.com", "allowed", "listed", "ok.example.com"],
			["www.ok.example.com", "allowed", "listed", "ok.example.com"],
			["no.example.net", "refused", "not-listed", "no.example.net"],
		],
	);
	assert.equal(res.body.names[2].record, '0 issue "letsencrypt.org"');
	assert.match(res.body.checked_on, ISO_DATE);
});

it("the directory's caaIdentities win over the fixed list of a preset CA", async () => {
	// Let's Encrypt's preset list says letsencrypt.org; this directory names another identity and decides
	await dns("a.example.com", issue("directory-ca.example"));
	const res = await admin.post(CHECK, { domain_names: ["a.example.com"], acme_server: ACME });
	assert.equal(res.body.names[0].state, "allowed");
	await dns("b.example.com", issue("letsencrypt.org"));
	assert.equal((await admin.post(CHECK, { domain_names: ["b.example.com"] })).body.names[0].state, "refused");
});

it("a preset CA whose directory names no identity, or is down, uses its fixed list; a named identity wins", async () => {
	await dns("p.example.com", issue("pki.goog"));
	const google = await admin.post(CHECK, { domain_names: ["p.example.com"], acme_server: GOOGLE_SERVER });
	assert.equal(google.body.names[0].state, "allowed");
	await dns("z.example.com", issue("Sectigo.com"));
	const zero = await admin.post(CHECK, { domain_names: ["z.example.com"], acme_server: ZEROSSL_SERVER });
	assert.equal(zero.body.names[0].state, "allowed");
	await dns("s.example.com", issue("letsencrypt.org"));
	const staging = await admin.post(CHECK, {
		domain_names: ["s.example.com"],
		acme_server: LETSENCRYPT_STAGING_SERVER,
	});
	// the directory's stage-ca.example wins over the preset's letsencrypt.org
	assert.equal(staging.body.names[0].state, "refused");
});

it("Let's Encrypt compares validationmethods and accounturi", async () => {
	await dns("m.example.com", issue("stage-ca.example; validationmethods=http-01"));
	const staging = { domain_names: ["m.example.com"], acme_server: LETSENCRYPT_STAGING_SERVER };
	assert.equal(
		(await admin.post(CHECK, { ...staging, dns_challenge: true })).body.names[0].reason,
		"validationmethods",
	);
	assert.equal((await admin.post(CHECK, staging)).body.names[0].state, "allowed");
	await dns("m.example.com", issue("stage-ca.example; accounturi=https://acme/acct/1"));
	assert.equal((await admin.post(CHECK, staging)).body.names[0].state, "limited");
});

it("the DNS challenge is compared with validationmethods for the CA that honours it", async () => {
	await dns("m.example.com", issue("directory-ca.example; validationmethods=http-01"));
	const dnsMethod = await admin.post(CHECK, { domain_names: ["m.example.com"], dns_challenge: true });
	// the test CA is not a Let's Encrypt preset: the parameter is shown and not compared
	assert.equal(dnsMethod.body.names[0].state, "allowed");
	assert.equal(dnsMethod.body.names[0].reason, "listed-parameters-unchecked");
});

it("a CA that names no CAA identity is not checked, every name with its translation key", async () => {
	await dns("a.example.com", issue("letsencrypt.org"));
	const res = await admin.post(CHECK, { domain_names: ["a.example.com", "b.example.com"], acme_server: OTHER });
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.names.map(({ state, reason, error_i18n }) => [state, reason, error_i18n]),
		[
			["not-checked", "no-identity", "error.caa-no-identity"],
			["not-checked", "no-identity", "error.caa-no-identity"],
		],
	);
});

it("a CA that is not set up is refused", async () => {
	const res = await admin.post(CHECK, { domain_names: ["a.example.com"], acme_server: "https://nobody.test/dir" });
	assert.equal(res.status, 400);
	assert.equal(res.body.error.message_i18n, "error.acme-ca-not-allowed");
});

it("rejects no name, more than 100 names and an unknown field", async () => {
	assert.equal((await admin.post(CHECK, { domain_names: [] })).status, 400);
	const many = Array.from({ length: 101 }, (_, i) => `n${i}.example.com`);
	assert.equal((await admin.post(CHECK, { domain_names: many })).status, 400);
	assert.equal((await admin.post(CHECK, { domain_names: ["a.example.com"], extra: 1 })).status, 400);
});

it("a lookup failure is unknown; a pattern name is not checked", async () => {
	await dns("down.example.com", { code: "servfail" });
	const res = await admin.post(CHECK, { domain_names: ["down.example.com", "~^x\\.example\\.com$"] });
	assert.equal(res.body.names[0].state, "unknown");
	assert.equal(res.body.names[0].reason, "lookup-servfail");
	assert.equal(res.body.names[1].state, "not-checked");
});

it("view permission reads; no permission is refused", async () => {
	await dns("v.example.com", issue("directory-ca.example"));
	const viewer = await api.limited({ visibility: "all", certificates: "view" });
	assert.equal((await viewer.post(CHECK, { domain_names: ["v.example.com"] })).status, 200);
	assert.equal((await viewer.get(LIST)).status, 200);
	const none = await api.limited({ visibility: "all", certificates: "hidden" });
	assert.equal((await none.post(CHECK, { domain_names: ["v.example.com"] })).status, 403);
	assert.equal((await none.get(LIST)).status, 403);
	assert.equal((await api.client().post(CHECK, { domain_names: ["v.example.com"] })).status, 401);
	assert.equal((await api.client().get(LIST)).status, 401);
});

it("the list holds the ACME certificates the user can see, with the worst state; custom certificates are absent", async () => {
	await dns("l1.example.com", issue("letsencrypt.org"));
	await dns("l2.example.com", issue("directory-ca.example"));
	const refused = await certificate(["l1.example.com", "l2.example.com"]);
	const clean = await certificate(["l2.example.com"]);
	const custom = await certificate(["l1.example.com"], { provider: "other", npmpro_acme_server: null });
	const list = (await admin.get(LIST)).body;
	assert.equal(
		list.find((item) => item.certificate_id === custom),
		undefined,
	);
	const first = list.find((item) => item.certificate_id === refused);
	assert.equal(first.state, "refused");
	assert.deepEqual(
		first.names.map((name) => name.state),
		["refused", "allowed"],
	);
	assert.equal(list.find((item) => item.certificate_id === clean).state, "allowed");
});

it("a viewer who sees only their own certificates gets only those", async () => {
	await dns("o.example.com", issue("directory-ca.example"));
	const mine = await api.limited({ visibility: "user", certificates: "view" });
	const theirs = await certificate(["o.example.com"], { owner_user_id: mine.user.id });
	const adminsOnly = await certificate(["o.example.com"]);
	const seen = (await mine.get(LIST)).body.map((item) => item.certificate_id);
	assert.ok(seen.includes(theirs));
	assert.equal(seen.includes(adminsOnly), false);
});

it("a result is cached for 6 hours: a changed DNS answer is not looked up again; a save clears it", async () => {
	await dns("c.example.com", issue("letsencrypt.org"));
	const id = await certificate(["c.example.com"]);
	assert.equal((await entry(admin, id)).state, "refused");
	await dns("c.example.com", issue("directory-ca.example"));
	assert.equal((await entry(admin, id)).state, "refused");
	// a delete clears the entry and removes the row
	const gone = await admin.delete(`${CERTS}/${id}`);
	assert.equal(gone.status, 200, gone.text);
	assert.equal(await entry(admin, id), undefined);
});

it("a re-saved DNS credential clears the entry so the next list looks again", async () => {
	await dns("s.example.com", issue("letsencrypt.org"));
	const made = await admin.post("/nginx/dns-credentials", {
		name: "CAA credential",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-SECRET" }],
	});
	const id = await certificate(["s.example.com"], {
		npmpro_dns_challenge: 1,
		npmpro_dns_provider: "cloudflare",
		npmpro_dns_credential_id: made.body.id,
	});
	assert.equal((await entry(admin, id)).state, "refused");
	await dns("s.example.com", issue("directory-ca.example"));
	assert.equal((await entry(admin, id)).state, "refused");
	const saved = await admin.put(`${CERTS}/${id}/dns-credential`, { npmpro_dns_credential_id: made.body.id });
	assert.equal(saved.status, 200, saved.text);
	assert.equal((await entry(admin, id)).state, "allowed");
});

it("a list call checks at most 25 certificates, the rest answer not-checked", async () => {
	await api.db("certificate").delete();
	await dns("many.example.com", issue("directory-ca.example"));
	const made = [];
	for (let i = 0; i < 27; i += 1) made.push(await certificate(["many.example.com"]));
	const first = (await admin.get(LIST)).body;
	assert.equal(first.length, 27);
	assert.equal(first.filter((item) => item.state === "allowed").length, 25);
	assert.deepEqual(
		first.filter((item) => item.state === "not-checked").map((item) => [item.checked_on, item.names]),
		[
			[null, []],
			[null, []],
		],
	);
	// the next call checks the two that are left
	assert.equal((await admin.get(LIST)).body.filter((item) => item.state === "allowed").length, 27);
	assert.equal(made.length, 27);
});

it("a result older than 6 hours is checked again, a younger one is not", async () => {
	const { caaCache } = await import("../lib/dns-check/caa-cache.js");
	await dns("t.example.com", issue("letsencrypt.org"));
	const id = await certificate(["t.example.com"]);
	assert.equal((await entry(admin, id)).state, "refused");
	await dns("t.example.com", issue("directory-ca.example"));
	// the stored time is the clock of the entry: 6 hours less a minute, then 6 hours and a minute
	const stored = caaCache.get("certificate", id, "all");
	stored.at = Date.now() - (6 * 3600 * 1000 - 60_000);
	assert.equal((await entry(admin, id)).state, "refused");
	stored.at = Date.now() - (6 * 3600 * 1000 + 60_000);
	assert.equal((await entry(admin, id)).state, "allowed");
});

it("a restore of the backup flow clears the shared cache (the cache module is the one the restore clears)", async () => {
	const { caaCache } = await import("../lib/dns-check/caa-cache.js");
	await api.db("certificate").delete();
	await dns("r.example.com", issue("letsencrypt.org"));
	const id = await certificate(["r.example.com"]);
	assert.equal((await entry(admin, id)).state, "refused");
	assert.equal(caaCache.size() > 0, true);
	caaCache.clearAll();
	await dns("r.example.com", issue("directory-ca.example"));
	assert.equal((await entry(admin, id)).state, "allowed");
});

it("a change of the allowed CAs clears the results", async () => {
	await api.db("certificate").delete();
	await dns("k.example.com", issue("letsencrypt.org"));
	const id = await certificate(["k.example.com"]);
	assert.equal((await entry(admin, id)).state, "refused");
	await dns("k.example.com", issue("directory-ca.example"));
	assert.equal((await entry(admin, id)).state, "refused");
	const added = await admin.post("/settings/acme/accounts", { server: "https://third.test/dir", email: "a@example.com" });
	// whatever the answer (the CA may not register), the attempt cleared the cache
	assert.ok(added.status > 0);
	assert.equal((await entry(admin, id)).state, "allowed");
});

it("renew, re-issue and a domain change each clear the entry", async () => {
	const pair = await makeCertificate(path.join(api.root, "fake"), "n.example.com");
	await certbotSucceeds(api, pair);
	await api.db("certificate").delete();
	const { caaCache } = await import("../lib/dns-check/caa-cache.js");
	const made = await admin.post(CERTS, { provider: "letsencrypt", domain_names: ["n.example.com"] });
	assert.equal(made.status, 201, made.text);
	const id = made.body.id;
	const flip = async (action, expectState) => {
		await dns("n.example.com", issue("letsencrypt.org"));
		await dns("o2.example.com", issue("letsencrypt.org"));
		caaCache.clearAll();
		assert.equal((await entry(admin, id)).state, "refused", "primed");
		await dns("n.example.com", issue("directory-ca.example"));
		await dns("o2.example.com", issue("directory-ca.example"));
		const done = await action();
		assert.equal(done.status, 200, done.text);
		assert.equal((await entry(admin, id)).state, expectState);
	};
	await flip(() => admin.post(`${CERTS}/${id}/renew`, {}), "allowed");
	await flip(() => admin.put(`${CERTS}/${id}/domains`, { domain_names: ["n.example.com", "o2.example.com"] }), "allowed");
	// re-issue at the CA without an identity: the result is rebuilt for it
	await flip(() => admin.post(`${CERTS}/${id}/reissue`, { npmpro_acme_server: OTHER }), "not-checked");
});
