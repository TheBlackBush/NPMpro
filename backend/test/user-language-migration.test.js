import assert from "node:assert/strict";
import { it } from "node:test";
import { up } from "../migrations/20261127120000_user_language.js";
import { migratedSqlite } from "./support/database.js";

// 20261127120000_user_language on SQLite; test/user-language-servers.test.js runs the same on Postgres and MySQL
it("adds user.npmpro_language as a nullable varchar(8) and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		const column = (await knex.raw("pragma table_info(user)")).find((c) => c.name === "npmpro_language");
		assert.equal(column.type.toLowerCase(), "varchar(8)");
		assert.equal(column.notnull, 0);
		await up(knex);
		await up(knex);
		const names = (await knex.raw("pragma table_info(user)")).filter((c) => c.name === "npmpro_language");
		assert.equal(names.length, 1);
	} finally {
		await db.cleanup();
	}
});
