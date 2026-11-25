import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { runMigrations } from "../lib/database/schema.js";
import { createStateStore } from "../lib/notify/state-store.js";
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
			// the chain ran both migrations once: the explicit calls are the reruns
			const { up } = await import("../migrations/20261126120000_notification_tables.js");
			const { up: addValidFrom } = await import("../migrations/20261126110000_certificate_valid_from.js");
			const table = "npmpro_notification_delivery";
			await ctx.knex("npmpro_notification_state").insert({
				key: "rerun:1",
				event: "cert_expiry",
				object_id: "1",
				state: "ok",
				since: NOW,
			});
			ctx.targetIndex = await indexColumns(ctx.knex, name, table, `${table}_target`);
			await up(ctx.knex);
			await addValidFrom(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("keeps its rows, indexes and column after the reruns", async () => {
			const { knex } = ctx;
			const table = "npmpro_notification_delivery";
			assert.equal(Number((await knex("npmpro_notification_state").count({ count: "*" }))[0].count), 1);
			assert.deepEqual(await indexColumns(knex, name, table, `${table}_target`), ctx.targetIndex);
			assert.equal(await knex.schema.hasColumn("certificate", "npmpro_valid_from"), true);
			await knex("npmpro_notification_state").where({ key: "rerun:1" }).del();
		});

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

		it("stores a 254 character recipient whole and refuses a longer one", async () => {
			const { knex } = ctx;
			const recipient = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
			assert.equal(recipient.length, 254);
			const base = {
				created_on: NOW,
				modified_on: NOW,
				message_id: "msg_r",
				event: "cert_expiry",
				channel: "mail",
				status: "pending",
			};
			await knex("npmpro_notification_delivery").insert({ ...base, recipient });
			assert.equal(
				(await knex("npmpro_notification_delivery").where({ message_id: "msg_r" }).first()).recipient,
				recipient,
			);
			await assert.rejects(knex("npmpro_notification_delivery").insert({ ...base, recipient: `${recipient}x` }));
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

		it("runs the state store: transitions, a racing insert, reminders, clearMatching and prune", async () => {
			const { knex } = ctx;
			await knex("npmpro_notification_state").delete();
			const clock = { at: Date.parse("2026-11-26T10:00:00Z"), now: () => clock.at };
			const [a, b] = [createStateStore({ knex, clock }), createStateStore({ knex, clock })];
			const event = "host.config_error";
			const raced = await Promise.all([
				a.report({ event, objectId: "proxy_host:12", state: "bad", data: { id: 12 } }),
				b.report({ event, objectId: "proxy_host:12", state: "bad", data: { id: 12 } }),
			]);
			assert.equal(raced.filter(Boolean).length, 1);
			assert.equal(await b.report({ event, objectId: "proxy_host:12", state: "bad", data: { id: 12 } }), null);
			await a.report({ event, objectId: "proxy_host:120", state: "bad", data: {} });
			await a.report({ event, objectId: "proxyxhost:12", state: "ok", data: {} });
			await a.report({ event, objectId: "x".repeat(300), state: "bad", data: {} });

			clock.at += 24 * 3_600_000;
			assert.equal((await a.dueReminders()).length, 3);
			assert.deepEqual(await b.dueReminders(), []);
			assert.equal(
				(await a.report({ event, objectId: "proxy_host:120", state: "ok", data: {} })).type,
				`${event}.resolved`,
			);

			await a.clearMatching(event, "proxy_host:12");
			const keys = (await knex("npmpro_notification_state").orderBy("id")).map((row) => row.key);
			assert.equal(keys.includes(`${event}:proxy_host:12`), false);
			assert.equal(keys.includes(`${event}:proxy_host:120`), true);
			assert.equal(keys.length, 3);

			clock.at += 31 * 24 * 3_600_000;
			await a.prune();
			assert.equal(Number((await knex("npmpro_notification_state").count({ count: "*" }))[0].count), 1);
			await knex("npmpro_notification_state").delete();
		});
	});
}
