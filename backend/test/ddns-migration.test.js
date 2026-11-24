import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-24 10:00:00";

let api;
before(async () => {
	api = await startApi();
});
after(() => api.stop());

// 20261124120000_ddns_records: columns, defaults, the unique name, the history cascade, a rerun
it("creates the DDNS tables with their defaults, a unique name, the history cascade and a safe rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		await knex.raw("pragma foreign_keys = on");
		const record = [
			"id",
			"created_on",
			"modified_on",
			"owner_user_id",
			"dns_credential_id",
			"provider",
			"name",
			"zone",
			"kind",
			"target",
			"ip_version",
			"ipv6_suffix",
			"ttl",
			"enabled",
			"state",
			"last_ipv4",
			"last_ipv6",
			"last_checked_on",
			"last_changed_on",
			"next_try_on",
			"failures",
			"error",
			"meta",
			"secret",
		];
		for (const column of record)
			assert.equal(await knex.schema.hasColumn("npmpro_ddns_record", column), true, column);
		for (const column of [
			"id",
			"ddns_record_id",
			"created_on",
			"kind",
			"ip_version",
			"old_ip",
			"new_ip",
			"message",
		]) {
			assert.equal(await knex.schema.hasColumn("npmpro_ddns_history", column), true, column);
		}

		const [credentialId] = await knex("npmpro_dns_credential").insert({
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			name: "Cloudflare main",
			provider: "cloudflare",
			values: "v1:x:y:z",
		});
		const row = {
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			dns_credential_id: credentialId,
			provider: "cloudflare",
			name: "home.example.com",
			zone: "example.com",
		};
		const [recordId] = await knex("npmpro_ddns_record").insert(row);
		await assert.rejects(knex("npmpro_ddns_record").insert(row));
		const stored = await knex("npmpro_ddns_record").where({ id: recordId }).first();
		assert.equal(stored.ip_version, "ipv4");
		assert.equal(stored.kind, "address");
		assert.equal(stored.target, null);
		assert.equal(Number(stored.enabled), 1);
		assert.equal(stored.state, "pending");
		assert.equal(stored.failures, 0);
		assert.equal(stored.secret, null);

		const [aliasId] = await knex("npmpro_ddns_record").insert({
			...row,
			name: "*.example.com",
			kind: "alias",
			target: "home.example.com",
		});
		const alias = await knex("npmpro_ddns_record").where({ id: aliasId }).first();
		assert.equal(alias.kind, "alias");
		assert.equal(alias.target, "home.example.com");
		assert.equal(alias.ip_version, "ipv4");
		await knex("npmpro_ddns_record").where({ id: aliasId }).del();

		await knex("npmpro_ddns_history").insert({
			ddns_record_id: recordId,
			created_on: NOW,
			kind: "created",
			new_ip: "203.0.113.7",
		});
		await assert.rejects(knex("npmpro_dns_credential").where({ id: credentialId }).del());
		await knex("npmpro_ddns_record").where({ id: recordId }).del();
		assert.equal((await knex("npmpro_ddns_history").count({ count: "*" }))[0].count, 0);

		const { up } = await import("../migrations/20261124120000_ddns_records.js");
		await up(knex);
	} finally {
		await db.cleanup();
	}
});

// the models on the real database of the test app: enabled as a boolean, meta as JSON, no secret in the JSON, relations
it("round-trips a record through its model: enabled, meta, the hidden secret and the history relation", async () => {
	const { default: DdnsRecord } = await import("../models/ddns_record.js");
	const { default: DdnsHistory } = await import("../models/ddns_history.js");
	const { default: DnsCredential } = await import("../models/dns_credential.js");
	const { default: User } = await import("../models/user.js");
	const user = await User.query().insert({
		email: "ddns-model@example.com",
		name: "Ddns",
		nickname: "d",
		avatar: "",
		roles: [],
	});
	const credential = await DnsCredential.query().insert({
		owner_user_id: user.id,
		name: "ddns model",
		provider: "cloudflare",
		values: "v1:x:y:z",
	});
	const record = await DdnsRecord.query().insert({
		owner_user_id: user.id,
		dns_credential_id: credential.id,
		provider: "cloudflare",
		name: "model.example.com",
		zone: "example.com",
		meta: { zone_id: "z1" },
		secret: "v1:sealed",
	});
	await DdnsHistory.query().insert({ ddns_record_id: record.id, kind: "created", new_ip: "203.0.113.7" });
	const found = await DdnsRecord.query().findById(record.id).withGraphFetched("[credential, owner, history]");
	assert.equal(found.enabled, true);
	assert.equal(found.state, "pending");
	assert.equal(found.kind, "address");
	assert.equal(found.target, null);
	assert.deepEqual(found.meta, { zone_id: "z1" });
	assert.equal(found.credential.id, credential.id);
	assert.equal(found.owner.id, user.id);
	assert.equal(found.history.length, 1);
	assert.equal(found.history[0].kind, "created");
	assert.equal(found.history[0].created_on !== undefined, true);
	const json = found.toJSON();
	assert.equal("secret" in json, false);
	assert.equal((await DdnsRecord.query().findById(record.id)).secret, "v1:sealed");
	await DdnsRecord.query().findById(record.id).patch({ enabled: false });
	assert.equal((await DdnsRecord.query().findById(record.id)).enabled, false);
	assert.equal((await DdnsHistory.query().findOne({ ddns_record_id: record.id })).record, undefined);
	assert.equal(
		(await DdnsHistory.query().findOne({ ddns_record_id: record.id }).withGraphFetched("record")).record.id,
		record.id,
	);
});
