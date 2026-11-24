import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// the store the engine reads and writes (internal/ddns-record.js ddnsStore) against the real database

const GONE = /gone/u;

let api;
let store;
let id;

before(async () => {
	api = await startApi();
	const admin = await api.admin();
	const credential = await admin.post("/nginx/dns-credentials", {
		name: "Store credential",
		provider: "cloudflare",
		fields: [{ key: "dns_cloudflare_api_token", value: "store-token-1234567890" }],
	});
	const record = await admin.post("/nginx/ddns-records", {
		name: "store.example.com",
		dns_credential_id: credential.body.id,
		zone: "example.com",
	});
	id = record.body.id;
	({ ddnsStore: store } = await import("../internal/ddns-record.js"));
});
after(() => api?.stop());

it("writes Date fields and reads them back as Date objects", async () => {
	const checked = new Date("2026-11-24T10:00:00.123Z");
	const next = new Date("2026-11-24T10:05:00.000Z");
	await store.saveRecord(id, { last_checked_on: checked, next_try_on: next, last_changed_on: null, state: "ok" });
	const row = await store.getRecord(id);
	assert.equal(row.last_checked_on.getTime(), checked.getTime());
	assert.equal(row.next_try_on.getTime(), next.getTime());
	assert.equal(row.last_changed_on, null);
	assert.equal(row.enabled, true);
	assert.deepEqual(
		(await store.enabledRecords()).map((one) => one.id),
		[id],
	);
	const raw = await api.db("npmpro_ddns_record").where({ id }).first();
	assert.equal(raw.next_try_on, "2026-11-24 10:05:00.000");
	// the API shows ISO times
	const shown = await (await api.admin()).get(`/nginx/ddns-records/${id}`);
	assert.equal(shown.body.next_try_on, next.toISOString());
});

it("keeps the newest rows of the history and only those", async () => {
	for (let n = 1; n <= 55; n++)
		await store.addHistory(id, { kind: "changed", ip_version: "ipv4", new_ip: `81.2.69.${n}` });
	await store.trimHistory(id, 50);
	const rows = await api.db("npmpro_ddns_history").where({ ddns_record_id: id }).orderBy("id");
	assert.equal(rows.length, 50);
	assert.equal(rows[0].new_ip, "81.2.69.6");
	assert.equal(rows.at(-1).new_ip, "81.2.69.55");
	await store.trimHistory(id, 50);
	assert.equal((await api.db("npmpro_ddns_history").where({ ddns_record_id: id })).length, 50);
});

it("opens the credential of a record for one run, with its secret values", async () => {
	const opened = await store.openCredential(await store.getRecord(id));
	assert.equal(opened.fields.dns_cloudflare_api_token, "store-token-1234567890");
	assert.deepEqual(opened.secrets, ["store-token-1234567890"]);
	await assert.rejects(store.openCredential({ provider: "cloudflare", dns_credential_id: 987654 }), GONE);
	// a custom record has no credential: its sealed URL is what the run gets, and it is scrubbed from every message
	assert.deepEqual(await store.openCredential({ provider: "custom", dns_credential_id: null, secret: null }), {
		fields: {},
		secrets: [],
	});
});
