import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-26 10:00:00";
const FILE = "../migrations/20261126120000_notification_tables.js";
const VALID_FROM_FILE = "../migrations/20261126110000_certificate_valid_from.js";

const indexes = async (knex, table) => {
	const list = await knex.raw(`pragma index_list(${table})`);
	const found = {};
	for (const index of list) {
		const info = await knex.raw(`pragma index_info(${index.name})`);
		found[index.name] = {
			unique: index.unique === 1,
			columns: info.sort((a, b) => a.seqno - b.seqno).map((c) => c.name),
		};
	}
	return found;
};

const columnNames = async (knex, table) => (await knex.raw(`pragma table_info(${table})`)).map((c) => c.name);

// 20261126120000_notification_tables: both tables, the unique key, the three delivery indexes, defaults, a rerun
it("creates the notification tables with their columns, indexes and defaults, and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		assert.deepEqual(await columnNames(knex, "npmpro_notification_state"), [
			"id",
			"key",
			"event",
			"object_id",
			"state",
			"since",
			"last_sent_on",
			"data",
		]);
		assert.deepEqual(await columnNames(knex, "npmpro_notification_delivery"), [
			"id",
			"created_on",
			"modified_on",
			"message_id",
			"event",
			"channel",
			"target_id",
			"recipient",
			"group_key",
			"payload",
			"status",
			"attempts",
			"next_try_on",
			"http_status",
			"duration_ms",
			"error",
			"response",
		]);

		const state = await indexes(knex, "npmpro_notification_state");
		assert.deepEqual(state.npmpro_notification_state_key, { unique: true, columns: ["key"] });
		const delivery = await indexes(knex, "npmpro_notification_delivery");
		assert.deepEqual(delivery.npmpro_notification_delivery_due, {
			unique: false,
			columns: ["status", "next_try_on"],
		});
		assert.deepEqual(delivery.npmpro_notification_delivery_target, {
			unique: false,
			columns: ["channel", "target_id", "id"],
		});
		assert.deepEqual(delivery.npmpro_notification_delivery_message, { unique: false, columns: ["message_id"] });

		const row = { key: "cert_expiry:1", event: "cert_expiry", object_id: "1", state: "soon", since: NOW };
		await knex("npmpro_notification_state").insert(row);
		await assert.rejects(knex("npmpro_notification_state").insert(row));
		const stored = await knex("npmpro_notification_state").first();
		assert.equal(stored.last_sent_on, null);
		assert.equal(stored.data, null);

		await knex("npmpro_notification_delivery").insert({
			created_on: NOW,
			modified_on: NOW,
			message_id: "msg_1",
			event: "cert_expiry",
			channel: "mail",
			status: "pending",
		});
		const queued = await knex("npmpro_notification_delivery").first();
		assert.equal(queued.attempts, 0);
		for (const column of ["target_id", "recipient", "group_key", "payload", "next_try_on", "error", "response"])
			assert.equal(queued[column], null, column);

		// a rerun adds nothing and keeps the rows
		const { up } = await import(FILE);
		await up(knex);
		assert.equal((await knex("npmpro_notification_state").count({ count: "*" }))[0].count, 1);
		assert.equal((await knex("npmpro_notification_delivery").count({ count: "*" }))[0].count, 1);
		assert.deepEqual(await indexes(knex, "npmpro_notification_delivery"), delivery);
	} finally {
		await db.cleanup();
	}
});

// 20261126110000_certificate_valid_from: a nullable column, old rows keep null, a rerun
it("adds certificate.npmpro_valid_from, keeps old rows null and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		assert.equal(await knex.schema.hasColumn("certificate", "npmpro_valid_from"), true);
		const cert = {
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			provider: "other",
			nice_name: "c",
			domain_names: "[]",
			expires_on: NOW,
			meta: "{}",
		};
		await knex("certificate").insert(cert);
		assert.equal((await knex("certificate").first()).npmpro_valid_from, null);
		await knex("certificate").update({ npmpro_valid_from: "2026-10-01 00:00:00" });

		const { up } = await import(VALID_FROM_FILE);
		await up(knex);
		assert.equal((await knex("certificate").first()).npmpro_valid_from, "2026-10-01 00:00:00");
		assert.equal((await knex("certificate").count({ count: "*" }))[0].count, 1);
	} finally {
		await db.cleanup();
	}
});
