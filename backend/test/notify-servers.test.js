import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { runMigrations } from "../lib/database/schema.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const NOW = "2026-11-26 10:00:00";

const indexColumns = async (knex, name, table, index) => {
	if (name === "postgres") {
		const { rows } = await knex.raw(
			"select a.attname from pg_index i join pg_class c on c.oid = i.indexrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where c.relname = ? order by array_position(i.indkey::int[], a.attnum::int)",
			[index],
		);
		return rows.map((row) => row.attname);
	}
	const [rows] = await knex.raw(
		"select column_name from information_schema.statistics where table_schema = database() and table_name = ? and index_name = ? order by seq_in_index",
		[table, index],
	);
	return rows.map((row) => row.column_name ?? row.COLUMN_NAME);
};

// 20261126110000 and 20261126120000 on the real database servers: a 191 character unique key, the three delivery
// indexes, the defaults, the new certificate column and a rerun
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`Notification tables on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await runMigrations(ctx.knex);
			const { up } = await import("../migrations/20261126120000_notification_tables.js");
			await up(ctx.knex);
			const { up: addValidFrom } = await import("../migrations/20261126110000_certificate_valid_from.js");
			await addValidFrom(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("keeps a 191 character key unique and fills the delivery defaults", async () => {
			const { knex } = ctx;
			const key = `cert_expiry:${"k".repeat(191 - 12)}`;
			assert.equal(key.length, 191);
			const row = { key, event: "cert_expiry", object_id: "1", state: "soon", since: NOW };
			await knex("npmpro_notification_state").insert(row);
			await assert.rejects(knex("npmpro_notification_state").insert(row));
			await knex("npmpro_notification_state").insert({ ...row, key: "other:1" });

			await knex("npmpro_notification_delivery").insert({
				created_on: NOW,
				modified_on: NOW,
				message_id: "msg_1",
				event: "cert_expiry",
				channel: "mail",
				group_key: key,
				status: "pending",
				response: "r".repeat(2048),
			});
			const queued = await knex("npmpro_notification_delivery").first();
			assert.equal(Number(queued.attempts), 0);
			assert.equal(queued.target_id, null);
			assert.equal(queued.response.length, 2048);
		});

		it("has the three delivery indexes in order", async () => {
			const { knex } = ctx;
			const table = "npmpro_notification_delivery";
			assert.deepEqual(await indexColumns(knex, name, table, `${table}_due`), ["status", "next_try_on"]);
			assert.deepEqual(await indexColumns(knex, name, table, `${table}_target`), ["channel", "target_id", "id"]);
			assert.deepEqual(await indexColumns(knex, name, table, `${table}_message`), ["message_id"]);
		});

		it("adds the certificate valid-from column as null", async () => {
			const { knex } = ctx;
			assert.equal(await knex.schema.hasColumn("certificate", "npmpro_valid_from"), true);
			await knex("certificate").insert({
				created_on: NOW,
				modified_on: NOW,
				owner_user_id: 1,
				provider: "other",
				nice_name: "c",
				domain_names: JSON.stringify([]),
				expires_on: NOW,
				meta: JSON.stringify({}),
			});
			assert.equal((await knex("certificate").first()).npmpro_valid_from, null);
		});
	});
}
