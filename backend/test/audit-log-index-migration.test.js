import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261107120000_audit_log_index.js";

it("adds the audit log index; a rerun is harmless", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("audit_log", (table) => {
		table.increments().primary();
		table.dateTime("created_on").notNull();
	});
	await up(knex);
	await up(knex);
	const names = (await knex("sqlite_master").where("type", "index").select("name")).map(({ name }) => name);
	assert.ok(names.includes("audit_log_created_on_id"));
	await knex.destroy();
});
