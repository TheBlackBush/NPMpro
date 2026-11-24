import assert from "node:assert/strict";
import { it } from "node:test";

// The DDNS store (internal/ddns-record.js ddnsStore) on a real database server: the Date round trip of the three
// time columns and the history trim. ctx: { api, admin }, the API already started on that server.

const ddnsStoreTests = (ctx) => {
	let id;
	let store;

	it("sets up a record and loads the store", async () => {
		const credential = await ctx.admin.post("/nginx/dns-credentials", {
			name: "Store credential",
			provider: "cloudflare",
			fields: [{ key: "dns_cloudflare_api_token", value: "store-token-1234567890" }],
		});
		assert.equal(credential.status, 201, credential.text);
		const record = await ctx.admin.post("/nginx/ddns-records", {
			name: "store.example.com",
			dns_credential_id: credential.body.id,
			zone: "example.com",
		});
		assert.equal(record.status, 201, record.text);
		id = record.body.id;
		({ ddnsStore: store } = await import("../../internal/ddns-record.js"));
	});

	it("writes Date fields and reads them back as the same instants", async () => {
		const checked = new Date("2026-11-24T10:00:00.000Z");
		const next = new Date("2026-11-24T10:05:00.000Z");
		await store.saveRecord(id, { last_checked_on: checked, next_try_on: next, last_changed_on: null, state: "ok" });
		const row = await store.getRecord(id);
		assert.equal(row.last_checked_on.getTime(), checked.getTime());
		assert.equal(row.next_try_on.getTime(), next.getTime());
		assert.equal(row.last_changed_on, null);
		assert.equal(row.enabled, true);
		const shown = await ctx.admin.get(`/nginx/ddns-records/${id}`);
		assert.equal(shown.body.next_try_on, next.toISOString());
		assert.equal(shown.body.last_checked_on, checked.toISOString());
	});

	it("keeps the newest 50 history rows and only those", async () => {
		for (let n = 1; n <= 55; n++) {
			await store.addHistory(id, { kind: "changed", ip_version: "ipv4", new_ip: `81.2.69.${n}` });
		}
		await store.trimHistory(id, 50);
		const rows = await ctx.api.db("npmpro_ddns_history").where({ ddns_record_id: id }).orderBy("id");
		assert.equal(rows.length, 50);
		assert.equal(rows[0].new_ip, "81.2.69.6");
		assert.equal(rows.at(-1).new_ip, "81.2.69.55");
		await store.trimHistory(id, 50);
		assert.equal((await ctx.api.db("npmpro_ddns_history").where({ ddns_record_id: id })).length, 50);
	});
};

export { ddnsStoreTests };
