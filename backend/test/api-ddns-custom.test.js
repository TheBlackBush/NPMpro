import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { startApi } from "./support/api.js";

const RECORDS = "/nginx/ddns-records";
const PUBLIC_IP = "81.2.69.160";
const DYN = "https://dyn.test";
const TOKEN = "tok-SECRET-custom-9876";
const HTTP_500 = /HTTP 500/u;
const SEALED = /^v1:/u;
const EXPECTED_TEXT = /expected text/u;

let api;
let admin;
let seen = [];
const logged = [];
const answer = { status: 200, body: "good" };

const add = (body, session = admin) => session.post(RECORDS, { provider: "custom", ...body });
const addOk = async (body, session = admin) => {
	const done = await add(body, session);
	if (done.status !== 201) throw new Error(`custom record create answered ${done.status}: ${done.text}`);
	return done.body;
};
const count = async () => Number((await api.db("npmpro_ddns_record").count({ count: "*" }).first()).count);
const mockDyn = () => {
	api.outside.http
		.get(DYN)
		.intercept({ path: () => true, method: () => true })
		.reply((options) => {
			seen.push({ path: options.path, method: options.method });
			return { statusCode: answer.status, data: answer.body };
		})
		.persist();
};

before(async () => {
	api = await startApi({ env: { DDNS_IPV4_SERVICES: "https://ip1.test https://ip2.test" } });
	admin = await api.admin();
	for (const method of ["log", "warn", "error", "info"]) {
		console[method] = (...args) => logged.push(args.map(String).join(" "));
	}
	api.outside.dns.set("ip1.test", "198.51.100.50");
	api.outside.dns.set("ip2.test", "198.51.100.51");
	api.outside.dns.set("dyn.test", "198.51.100.70");
	for (const host of ["ip1.test", "ip2.test"]) {
		api.outside.http
			.get(`https://${host}`)
			.intercept({ path: "/", method: "GET" })
			.reply(() => ({ statusCode: 200, data: `${PUBLIC_IP}\n` }))
			.persist();
	}
	mockDyn();
});
afterEach(async () => {
	seen = [];
	answer.status = 200;
	answer.body = "good";
	await api.db("npmpro_ddns_history").del();
	await api.db("npmpro_ddns_record").del();
});
after(() => api?.stop());

it("lists the custom provider as administrators only, without a credential or zone", async () => {
	const providers = await admin.get("/nginx/ddns/providers");
	const custom = providers.body.find((provider) => provider.id === "custom");
	assert.equal(custom.admin_only, true);
	assert.equal(custom.credential_provider, null);
	assert.equal(custom.zoneless, true);
	assert.equal(custom.wildcards, false);
	assert.equal(custom.aliases, false);
});

it("lets only an administrator create, change, delete and update a custom record", async () => {
	const manager = await api.limited({ visibility: "all", certificates: "manage" });
	const refused = await add({ name: "home.example.com", url: `${DYN}/u/${TOKEN}` }, manager);
	assert.equal(refused.status, 403, refused.text);
	assert.equal(await count(), 0);
	const record = await addOk({ name: "home.example.com", url: `${DYN}/u/${TOKEN}`, method: "POST", expect: "good" });
	assert.equal(record.provider, "custom");
	assert.equal(record.dns_credential_id, null);
	assert.equal(record.url_set, true);
	assert.equal(record.method, "POST");
	assert.equal(record.expect, "good");
	assert.equal(record.ttl, null);
	// the row is visible and read-only for a user who may manage certificates
	const shown = await manager.get(`${RECORDS}/${record.id}`);
	assert.equal(shown.status, 200, shown.text);
	assert.equal(shown.body.url_set, true);
	assert.equal((await manager.put(`${RECORDS}/${record.id}`, { enabled: false })).status, 403);
	assert.equal((await manager.put(`${RECORDS}/${record.id}`, { url: `${DYN}/other` })).status, 403);
	assert.equal((await manager.delete(`${RECORDS}/${record.id}`)).status, 403);
	assert.equal((await manager.post(`${RECORDS}/${record.id}/update`)).status, 403);
	assert.equal((await admin.get(`${RECORDS}/${record.id}`)).body.enabled, true);
	assert.deepEqual(seen, []);
});

it("never shows the URL: not in an answer, list, history, audit entry, log or the database", async () => {
	const record = await addOk({ name: "leak.example.com", url: `${DYN}/u/${TOKEN}?host={name}`, expect: "good" });
	answer.status = 500;
	answer.body = `error for ${DYN}/u/${TOKEN}`;
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "failed");
	assert.match(run.body.error, HTTP_500);
	const row = await api.db("npmpro_ddns_record").where({ id: record.id }).first();
	assert.match(row.secret, SEALED);
	const texts = [
		JSON.stringify(row),
		JSON.stringify(await api.db("npmpro_ddns_history").where({ ddns_record_id: record.id })),
		JSON.stringify(await api.db("audit_log").where({ object_type: "ddns-record" })),
		run.text,
		(await admin.get(`${RECORDS}/${record.id}`)).text,
		(await admin.get(RECORDS)).text,
		(await admin.get(`${RECORDS}?expand=credential,owner`)).text,
		(await admin.get(`${RECORDS}/${record.id}/history`)).text,
		(await admin.get("/nginx/ddns/status")).text,
		JSON.stringify(record),
		logged.join("\n"),
	];
	for (const text of texts) {
		assert.ok(!text.includes(TOKEN), text.slice(0, 200));
		assert.ok(!text.includes("dyn.test/u"), text.slice(0, 200));
	}
});

it("refuses a URL that is not https, has a placeholder in the host, or is blocked, at save", async () => {
	const refuse = async (url, key) => {
		const done = await add({ name: "home.example.com", url });
		assert.equal(done.status, 400, `${url}: ${done.text}`);
		assert.equal(done.body.error.message_i18n, key, url);
		assert.ok(!done.text.includes(TOKEN));
	};
	await refuse(`http://dyn.test/u/${TOKEN}`, "error.ddns-custom-url-https");
	await refuse(`https://{name}.dyn.test/u/${TOKEN}`, "error.ddns-custom-host-placeholder");
	await refuse(`https://dyn.{ip}/u/${TOKEN}`, "error.ddns-custom-host-placeholder");
	await refuse(`https://dyn.test/u/${TOKEN}/{secret}`, "error.ddns-custom-url-invalid");
	await refuse(`https://user:pass@dyn.test/u/${TOKEN}`, "error.ddns-custom-url-invalid");
	await refuse(`https://127.0.0.1/x?t=${TOKEN}`, "error.ddns-custom-url-blocked");
	await refuse(`https://[::1]/x?t=${TOKEN}`, "error.ddns-custom-url-blocked");
	const missing = await add({ name: "home.example.com" });
	assert.equal(missing.status, 400, missing.text);
	assert.equal(await count(), 0);
});

it("checks the guard again at every call: a name that now points at a blocked address fails", async () => {
	const record = await addOk({ name: "late.example.com", url: `https://late.test/u/${TOKEN}` });
	api.outside.dns.set("late.test", "127.0.0.1");
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "failed");
	assert.ok(!run.text.includes("late.test"));
	assert.ok(!run.text.includes(TOKEN));
	assert.deepEqual(seen, []);
});

it("fills the placeholders in the path and the query, URL-encoded, and sends the saved method", async () => {
	const record = await addOk({
		name: "home.example.com",
		url: `${DYN}/u/${TOKEN}/{name}?ip={ip}&v4={ipv4}&v6={ipv6}`,
		method: "POST",
		expect: "good",
	});
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.status, 200, run.text);
	assert.equal(run.body.state, "ok", run.text);
	assert.deepEqual(seen, [
		{ path: `/u/${TOKEN}/home.example.com?ip=${PUBLIC_IP}&v4=${PUBLIC_IP}&v6=`, method: "POST" },
	]);
	assert.equal(run.body.last_ipv4, PUBLIC_IP);
	const history = await admin.get(`${RECORDS}/${record.id}/history`);
	assert.equal(history.body.length, 1);
	assert.equal(history.body[0].new_ip, PUBLIC_IP);
});

it("counts an answer without the expected text as a failure, and any 2xx as success when none is set", async () => {
	const strict = await addOk({ name: "strict.example.com", url: `${DYN}/s/${TOKEN}`, expect: "good" });
	answer.body = "badauth";
	const failed = await admin.post(`${RECORDS}/${strict.id}/update`);
	assert.equal(failed.body.state, "failed", failed.text);
	assert.match(failed.body.error, EXPECTED_TEXT);
	assert.ok(!failed.text.includes("badauth"));
	const loose = await addOk({ name: "loose.example.com", url: `${DYN}/l/${TOKEN}` });
	const ok = await admin.post(`${RECORDS}/${loose.id}/update`);
	assert.equal(ok.body.state, "ok", ok.text);
});

it("keeps the stored URL when a change sends an empty url, and replaces it with a new one", async () => {
	const record = await addOk({ name: "keep.example.com", url: `${DYN}/k/${TOKEN}` });
	const kept = await admin.put(`${RECORDS}/${record.id}`, { url: "", method: "POST" });
	assert.equal(kept.status, 200, kept.text);
	assert.equal(kept.body.url_set, true);
	assert.equal(kept.body.method, "POST");
	assert.ok(!kept.text.includes(TOKEN));
	const run = await admin.post(`${RECORDS}/${record.id}/update`);
	assert.equal(run.body.state, "ok", run.text);
	assert.deepEqual(seen, [{ path: `/k/${TOKEN}`, method: "POST" }]);
	const bad = await admin.put(`${RECORDS}/${record.id}`, { url: "http://dyn.test/x" });
	assert.equal(bad.body.error.message_i18n, "error.ddns-custom-url-https");
	const changed = await admin.put(`${RECORDS}/${record.id}`, { url: `${DYN}/n/${TOKEN}` });
	assert.equal(changed.status, 200, changed.text);
	assert.equal(changed.body.state, "pending");
});

it("refuses a credential, a TTL, an alias, a wildcard or a URL on the wrong provider", async () => {
	const refuse = async (body, key) => {
		const done = await add({ url: `${DYN}/x/${TOKEN}`, ...body });
		assert.equal(done.status, 400, `${done.text} ${JSON.stringify(body)}`);
		assert.equal(done.body.error.message_i18n, key, JSON.stringify(body));
	};
	await refuse({ name: "a.example.com", ttl: 300 }, "error.ddns-ttl-unsupported");
	await refuse({ name: "a.example.com", kind: "alias", target: "b.example.net" }, "error.ddns-alias-unsupported");
	await refuse({ name: "*.example.com" }, "error.ddns-wildcard-unsupported");
	await refuse({ name: "a.example.com", dns_credential_id: 1 }, "error.ddns-custom-no-credential");
	const made = await admin.post("/nginx/dns-credentials", {
		name: "Cloudflare for custom test",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "cf-token-custom-1234567890" }],
	});
	const other = await admin.post(RECORDS, {
		name: "b.example.com",
		dns_credential_id: made.body.id,
		url: `${DYN}/x`,
	});
	assert.equal(other.status, 400, other.text);
	assert.equal(other.body.error.message_i18n, "error.ddns-custom-fields-only");
});
