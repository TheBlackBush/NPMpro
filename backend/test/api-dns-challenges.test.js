import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { acmeDirectory, certbotSucceeds, makeCertificate, normalizedCalls } from "./support/certbot.js";

const TOKEN = "cf-token-challenges-1234567890";
const HOST = "https://api.cloudflare.com";
const ACME = "https://acme.test/directory";
const ZONE_ID = "f".repeat(32);
const json = { headers: { "content-type": "application/json" } };
const NAME = "_acme-challenge.example.org";
const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const rid = (n) => n.toString(16).padStart(32, "0");

let api;
let admin;
let certbot;
let pair;
let credentials = 0;
let shared = null;

const credential = async (session, domains = ["example.org"], { provider = "cloudflare", ...body } = {}) => {
	credentials += 1;
	const fields = provider === "cloudflare" ? [{ key: "dns_cloudflare_api_token", value: TOKEN }] : undefined;
	const done = await session.post("/nginx/dns-credentials", {
		name: `Credential ${credentials}`,
		provider,
		...(fields ? { fields } : {}),
		...body,
	});
	if (done.status !== 201) throw new Error(`credential create answered ${done.status}: ${done.text}`);
	if (domains.length > 0) {
		const added = await session.post("/nginx/dns-domains", { dns_credential_id: done.body.id, names: domains });
		if (added.status !== 201) throw new Error(`domains create answered ${added.status}: ${added.text}`);
	}
	return done.body;
};

// the credential of the zone example.org (a zone belongs to one credential of an owner)
const main = async () => {
	shared ??= await credential(admin);
	return shared;
};

// one answer of the fake Cloudflare; times is how often the same call may be made, delay holds the answer back
const answer = ({ method, url, status, body }, { times = 1, delay = 0 } = {}) => {
	const scope = api.outside.http.get(HOST).intercept({ path: url, method }).reply(status, body, json).times(times);
	if (delay > 0) scope.delay(delay);
};
const zoneCall = (options, zone = "example.org") =>
	answer(
		{
			method: "GET",
			url: `/client/v4/zones?name=${zone}`,
			status: 200,
			body: { success: true, result: [{ id: ZONE_ID }] },
		},
		options,
	);
const record = (n, name, content, modified) => ({
	id: rid(n),
	type: "TXT",
	name,
	content,
	modified_on: modified,
});
const listCall = (records, options) =>
	answer(
		{
			method: "GET",
			url: `/client/v4/zones/${ZONE_ID}/dns_records?name.startswith=_acme-challenge&per_page=100&page=1`,
			status: 200,
			body: { success: true, result: records, result_info: { page: 1, total_pages: 1 } },
		},
		options,
	);
const findCall = (name, records, options) =>
	answer(
		{
			method: "GET",
			url: `/client/v4/zones/${ZONE_ID}/dns_records?name.exact=${encodeURIComponent(name)}`,
			status: 200,
			body: { success: true, result: records },
		},
		options,
	);
const deleteCall = (n, status = 200, body = { success: true, result: { id: rid(n) } }) =>
	answer({ method: "DELETE", url: `/client/v4/zones/${ZONE_ID}/dns_records/${rid(n)}`, status, body });
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const get = (id, session = admin) => session.get(`/nginx/dns-credentials/${id}/challenges`);
const del = (id, items, session = admin) => session.post(`/nginx/dns-credentials/${id}/challenges/delete`, { items });
const item = (n, value, name = NAME) => ({ name, id: rid(n), values: [value] });
const untouched = () => api.outside.http.pendingInterceptors().length === 0;
const auditRows = () => api.db("audit_log").where({ object_type: "dns-credential", action: "challenges-deleted" });
const release = path.join("fake", "release-hold");
const hold = (code = 0) => writeFile(path.join(api.root, release), String(code));

before(async () => {
	api = await startApi({ env: { ACME_SERVER: ACME, NPMPRO_TEST_OUTBOUND: "mock" } });
	api.outside.dns.set("api.cloudflare.com", "198.51.100.20");
	api.outside.dns.set("acme.test", "192.0.2.40");
	acmeDirectory(api, ACME);
	admin = await api.admin();
	certbot = await import("../lib/certbot.js");
	pair = await makeCertificate(path.join(api.root, "fake"), "a.example.com");
	await certbotSucceeds(api, pair);
	// one certificate, so the CA has a renewal conf and its lock is held by every cleanup
	const made = await admin.post("/nginx/certificates", { provider: "letsencrypt", domain_names: ["a.example.com"] });
	if (made.status !== 201) throw new Error(`the first certificate answered ${made.status}: ${made.text}`);
});
after(() => api?.stop());

it("needs manage and the credential: 401, 403 for a view user and a view token, 404 for another owner", async () => {
	const mine = await main();
	const viewer = await api.limited({ visibility: "user", certificates: "view" });
	assert.equal((await get(mine.id, viewer)).status, 403);
	assert.equal((await del(mine.id, [item(1, "v")], viewer)).status, 403);
	const made = await admin.post("/users/me/api-tokens", {
		name: "challenges-view",
		permissions: Object.fromEntries(SECTIONS.map((s) => [s, s === "certificates" ? "view" : "hidden"])),
	});
	const headers = { authorization: `Bearer ${made.body.token}` };
	assert.equal((await api.client().get(`/nginx/dns-credentials/${mine.id}/challenges`, { headers })).status, 403);
	assert.equal((await api.client().get(`/nginx/dns-credentials/${mine.id}/challenges`)).status, 401);
	const own = await api.limited({ visibility: "user", certificates: "manage" });
	assert.equal((await get(mine.id, own)).status, 404);
	assert.equal((await del(mine.id, [item(1, "v")], own)).status, 404);
	assert.equal((await get(999999)).status, 404);
});

it("answers supported false for a provider without the calls, and no items without domains", async () => {
	const ini = await credential(admin, [], { provider: "acmedns", ini: "dns_acmedns_api_url = https://a.example\n" });
	const res = await get(ini.id);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body, { supported: false, busy: false, items: [], skipped_cnames: 0, truncated: false });
	assert.equal((await del(ini.id, [item(1, "v")])).status, 400);
	const empty = await credential(admin, []);
	const none = await get(empty.id);
	assert.equal(none.status, 200, none.text);
	assert.equal(none.body.supported, true);
	assert.deepEqual(none.body.items, []);
	assert.equal(none.body.error_i18n, "error.dns-cleanup-no-domains");
	assert.ok(untouched());
});

it("lists the challenge records with their age, recent and preselected, a CNAME counted", async () => {
	const mine = await main();
	zoneCall();
	listCall([
		record(1, NAME, '"old-token"', minutesAgo(120)),
		record(2, `${NAME}`, "middle-token", minutesAgo(30)),
		record(3, "_acme-challenge.www.example.org", "new-token", minutesAgo(2)),
		record(4, "_acme-challenge.x.example.org", "no-time", undefined),
		{ id: rid(5), type: "CNAME", name: "_acme-challenge.d.example.org", content: "t.example.net" },
		{ id: rid(6), type: "TXT", name: "_acme-txt.example.org", content: "noise" },
	]);
	const res = await get(mine.id);
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.supported, true);
	assert.equal(res.body.busy, false);
	assert.equal(res.body.skipped_cnames, 1);
	const byValue = Object.fromEntries(res.body.items.map((entry) => [entry.values[0], entry]));
	assert.deepEqual(
		Object.keys(byValue).sort((a, b) => a.localeCompare(b)),
		["middle-token", "new-token", "no-time", "old-token"],
	);
	assert.equal(byValue["old-token"].preselected, true);
	assert.equal(byValue["old-token"].recent, false);
	assert.ok(byValue["old-token"].age_seconds >= 7200);
	assert.equal(byValue["middle-token"].preselected, false);
	assert.equal(byValue["new-token"].recent, true);
	assert.equal(byValue["new-token"].preselected, false);
	assert.equal(byValue["no-time"].age_seconds, null);
	assert.equal(byValue["no-time"].preselected, false);
	assert.ok(untouched());
});

it("says busy and preselects nothing while a certbot run counts, and refuses a delete with 409", async () => {
	const mine = await main();
	await api.outside.hookCommand(
		"certbot",
		`#!/bin/sh\nwhile [ ! -f "${path.join(api.root, release)}" ]; do sleep 0.05; done\n`,
	);
	const running = certbot.runCertbot(["renew"]);
	try {
		assert.equal(certbot.certbotRunning(), 1);
		zoneCall();
		listCall([record(1, NAME, "old-token", minutesAgo(300))]);
		const res = await get(mine.id);
		assert.equal(res.body.busy, true);
		assert.equal(res.body.items[0].preselected, false);
		const refused = await del(mine.id, [item(1, "old-token")]);
		assert.equal(refused.status, 409, refused.text);
		assert.equal(refused.body.error.message_i18n, "error.dns-cleanup-busy");
		assert.equal((await auditRows()).length, 0);
	} finally {
		await hold();
		await running;
		await certbotSucceeds(api, pair);
	}
	assert.equal(certbot.certbotRunning(), 0);
	assert.ok(untouched());
});

it("deletes what is unchanged and skips a changed item, one outside the domains, a gone one; scrubs a failure", async () => {
	const mine = await main();
	const outside = { name: "_acme-challenge.other.net", id: rid(9), values: ["x"] };
	// the list again: A as chosen, B with another value, D gone, E as chosen
	zoneCall({ times: 3 });
	listCall([
		record(1, "_acme-challenge.a.example.org", "tok-a", minutesAgo(90)),
		record(2, "_acme-challenge.b.example.org", "tok-b-new", minutesAgo(90)),
		record(5, "_acme-challenge.e.example.org", "tok-e", minutesAgo(90)),
	]);
	findCall("_acme-challenge.a.example.org", [record(1, "_acme-challenge.a.example.org", "tok-a", minutesAgo(90))]);
	deleteCall(1);
	findCall("_acme-challenge.e.example.org", [record(5, "_acme-challenge.e.example.org", "tok-e", minutesAgo(90))], {
		times: 2,
	});
	deleteCall(5, 500, { success: false, errors: [{ message: `boom ${TOKEN}` }] });
	const res = await del(mine.id, [
		item(1, "tok-a", "_acme-challenge.a.example.org"),
		item(2, "tok-b", "_acme-challenge.b.example.org"),
		outside,
		item(4, "tok-d", "_acme-challenge.d.example.org"),
		item(5, "tok-e", "_acme-challenge.e.example.org"),
	]);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.results.map(({ result, reason }) => (reason ? `${result}:${reason}` : result)),
		["deleted", "skipped:changed", "skipped:outside", "gone", "failed"],
	);
	assert.ok(res.body.results[4].message.includes("boom"));
	assert.ok(!res.text.includes(TOKEN), "the answer holds the token");
	assert.ok(untouched());
	const [audit] = await auditRows();
	assert.equal(audit.object_id, mine.id);
	const meta = typeof audit.meta === "string" ? JSON.parse(audit.meta) : audit.meta;
	assert.deepEqual(meta, {
		name: mine.name,
		id: mine.id,
		names: ["_acme-challenge.a.example.org"],
		count: 1,
	});
	for (const value of ["tok-a", "tok-b", "tok-e", TOKEN]) assert.ok(!JSON.stringify(audit).includes(value), value);
});

it("validates the body: 1 to 100 items with a name, id and values", async () => {
	const mine = await main();
	assert.equal((await del(mine.id, [])).status, 400);
	assert.equal(
		(
			await del(
				mine.id,
				Array.from({ length: 101 }, (_, i) => item(i, "v")),
			)
		).status,
		400,
	);
	assert.equal((await admin.post(`/nginx/dns-credentials/${mine.id}/challenges/delete`, {})).status, 400);
	assert.equal((await del(mine.id, [{ name: NAME, values: ["v"] }])).status, 400);
});

it("lists the providers with cleans_challenges", async () => {
	const res = await admin.get("/nginx/certificates/dns-providers");
	const byId = Object.fromEntries(res.body.map((provider) => [provider.id, provider]));
	assert.equal(byId.cloudflare.cleans_challenges, true);
	assert.equal(byId.acmedns.cleans_challenges, false);
});

it("holds the CA locks: a certificate request started during a delete waits for it", async () => {
	const mine = await main();
	const certonly = async () => (await normalizedCalls(api)).filter((line) => line.includes(" certonly ")).length;
	const earlier = await certonly();
	zoneCall({ times: 2, delay: 600 });
	listCall([record(1, NAME, "tok-a", minutesAgo(90))]);
	findCall(NAME, [record(1, NAME, "tok-a", minutesAgo(90))]);
	deleteCall(1);
	const deleting = del(mine.id, [item(1, "tok-a")]);
	await new Promise((resolve) => setTimeout(resolve, 200));
	const requesting = admin.post("/nginx/certificates", { provider: "letsencrypt", domain_names: ["b.example.com"] });
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(await certonly(), earlier, "certbot ran during the delete");
	const done = await deleting;
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.results[0].result, "deleted");
	const made = await requesting;
	assert.equal(made.status, 201, made.text);
	assert.equal(await certonly(), earlier + 1);
	assert.ok(untouched());
});

it("refuses a delete when the CA locks cannot be taken, without a provider call", async () => {
	const mine = await main();
	const earlier = (await auditRows()).length;
	const { default: accounts } = await import("../models/acme_account.js");
	const query = accounts.query;
	accounts.query = () => {
		throw new Error("no accounts");
	};
	try {
		const res = await del(mine.id, [item(1, "tok-a")]);
		assert.equal(res.status, 409, res.text);
		assert.equal(res.body.error.message_i18n, "error.dns-cleanup-no-locks");
	} finally {
		accounts.query = query;
	}
	assert.equal((await auditRows()).length, earlier);
});

it("sees a certbot run that started while the delete waited for a lock", async () => {
	const mine = await main();
	const { withAccountLock } = await import("../internal/acme-account.js");
	let letGo;
	const held = new Promise((resolve) => {
		letGo = resolve;
	});
	let locked;
	const taken = new Promise((resolve) => {
		locked = resolve;
	});
	const holder = withAccountLock(ACME, () => {
		locked();
		return held;
	});
	await taken;
	const deleting = del(mine.id, [item(1, "tok-a")]);
	await new Promise((resolve) => setTimeout(resolve, 200));
	await api.outside.hookCommand(
		"certbot",
		`#!/bin/sh\nwhile [ ! -f "${path.join(api.root, "fake/release-wait")}" ]; do sleep 0.05; done\n`,
	);
	const running = certbot.runCertbot(["renew"]);
	letGo();
	await holder;
	const res = await deleting;
	await writeFile(path.join(api.root, "fake/release-wait"), "0");
	await running;
	await certbotSucceeds(api, pair);
	assert.equal(res.status, 409, res.text);
	assert.equal(res.body.error.message_i18n, "error.dns-cleanup-busy");
	assert.ok(untouched(), "the provider was asked");
});

it("skips an item the provider changed between the list and the delete", async () => {
	const mine = await main();
	zoneCall({ times: 2 });
	listCall([record(1, NAME, "tok-a", minutesAgo(90))]);
	findCall(NAME, [record(1, NAME, "tok-a-other", minutesAgo(90))]);
	const res = await del(mine.id, [item(1, "tok-a")]);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.results.map(({ result, reason }) => `${result}:${reason}`),
		["skipped:changed"],
	);
	assert.ok(untouched());
});

it("merges an item sent twice and counts a record once in the audit", async () => {
	const mine = await main();
	const earlier = (await auditRows()).length;
	zoneCall({ times: 2 });
	listCall([record(1, NAME, "tok-a", minutesAgo(90))]);
	findCall(NAME, [record(1, NAME, "tok-a", minutesAgo(90))]);
	deleteCall(1);
	const res = await del(mine.id, [item(1, "tok-a"), item(1, "tok-a")]);
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.results.map(({ result }) => result),
		["deleted"],
	);
	const rows = await auditRows();
	assert.equal(rows.length, earlier + 1);
	const meta = typeof rows.at(-1).meta === "string" ? JSON.parse(rows.at(-1).meta) : rows.at(-1).meta;
	assert.equal(meta.count, 1);
	assert.ok(untouched());
});

it("lists at most 100 zones of a credential and says it is cut", async () => {
	const many = await credential(
		admin,
		Array.from({ length: 100 }, (_, i) => `cap${i}.example.net`),
		{ name: "Many zones" },
	);
	const added = await admin.post("/nginx/dns-domains", { dns_credential_id: many.id, names: ["cap100.example.net"] });
	assert.equal(added.status, 201, added.text);
	const zoneCalls = [];
	api.outside.http
		.get(HOST)
		.intercept({ path: (url) => url.startsWith("/client/v4/zones?name="), method: "GET" })
		.reply((options) => {
			zoneCalls.push(options.path);
			return { statusCode: 200, data: { success: true, result: [{ id: ZONE_ID }] }, responseOptions: json };
		})
		.times(100);
	api.outside.http
		.get(HOST)
		.intercept({ path: (url) => url.includes("/dns_records?name.startswith="), method: "GET" })
		.reply(200, { success: true, result: [], result_info: { page: 1, total_pages: 1 } }, json)
		.times(100);
	const res = await get(many.id);
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.truncated, true);
	assert.equal(zoneCalls.length, 100);
	assert.ok(untouched());
});
