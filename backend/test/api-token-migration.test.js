import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

const UNIQUE = /UNIQUE/u;

const COLUMNS = [
	"user_id",
	"name",
	"lookup_id",
	"secret_hash",
	"visibility",
	"proxy_hosts",
	"redirection_hosts",
	"dead_hosts",
	"streams",
	"access_lists",
	"certificates",
	"is_admin",
	"allow_delete",
	"expiry_audited",
	"expires_on",
	"last_used_on",
	"created_on",
];

// 20261117120000_api_tokens: the table and the audit log columns, and a rerun after a partial run
it("creates npmpro_api_token and the audit log token columns", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		assert.equal(await knex.schema.hasTable("npmpro_api_token"), true);
		for (const column of COLUMNS) {
			assert.equal(await knex.schema.hasColumn("npmpro_api_token", column), true, column);
		}
		assert.equal(await knex.schema.hasColumn("audit_log", "npmpro_api_token_id"), true);
		assert.equal(await knex.schema.hasColumn("audit_log", "npmpro_api_token_name"), true);
		const row = {
			user_id: 1,
			name: "ci",
			lookup_id: "0000000000000000",
			secret_hash: "a".repeat(64),
			visibility: "user",
			proxy_hosts: "view",
			redirection_hosts: "hidden",
			dead_hosts: "hidden",
			streams: "hidden",
			access_lists: "view",
			certificates: "view",
			created_on: 4102444800,
		};
		await knex("npmpro_api_token").insert(row);
		await assert.rejects(knex("npmpro_api_token").insert({ ...row, name: "other" }), UNIQUE);
		await assert.rejects(knex("npmpro_api_token").insert({ ...row, lookup_id: "1111111111111111" }), UNIQUE);
		const stored = await knex("npmpro_api_token").first();
		assert.equal(Number(stored.is_admin), 0);
		assert.equal(stored.expires_on, null);
		// a rerun (MySQL DDL is not transactional) changes nothing
		const { up } = await import("../migrations/20261117120000_api_tokens.js");
		await up(knex);
	} finally {
		await db.cleanup();
	}
});
