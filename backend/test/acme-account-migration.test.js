import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

const COLUMNS = [
	"server",
	"email",
	"eab_kid",
	"eab_hmac_key",
	"account_id",
	"state",
	"error",
	"registered_on",
	"created_on",
	"modified_on",
];

// 20261119120000_acme_accounts: the table, its unique server, a rerun after a partial run
it("creates npmpro_acme_account with a unique server", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		for (const column of COLUMNS) {
			assert.equal(await knex.schema.hasColumn("npmpro_acme_account", column), true, column);
		}
		const row = {
			server: "https://ca.lan/dir",
			state: "registered",
			account_id: "a".repeat(32),
			created_on: "2026-11-19 10:00:00",
			modified_on: "2026-11-19 10:00:00",
		};
		await knex("npmpro_acme_account").insert(row);
		await assert.rejects(knex("npmpro_acme_account").insert({ ...row, account_id: "b".repeat(32) }));
		const { state: _state, ...withoutState } = row;
		await knex("npmpro_acme_account").insert({ ...withoutState, server: "https://other/dir" });
		assert.equal((await knex("npmpro_acme_account").where("server", "https://other/dir").first()).state, "pending");
		const { up } = await import("../migrations/20261119120000_acme_accounts.js");
		await up(knex);
	} finally {
		await db.cleanup();
	}
});
