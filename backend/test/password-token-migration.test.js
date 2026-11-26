import assert from "node:assert/strict";
import { it } from "node:test";
import { up } from "../migrations/20261127130000_password_tokens.js";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-27 10:00:00";

// 20261127130000_password_tokens on SQLite; the Postgres and MySQL checks are in test/notify-servers.test.js
it("creates npmpro_password_token with its columns, unique hash, user index and user foreign key, and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		const columns = await knex.raw("pragma table_info(npmpro_password_token)");
		assert.deepEqual(
			columns.map((c) => c.name),
			["id", "user_id", "purpose", "token_hash", "created_on", "expires_on", "used_on", "requested_ip"],
		);
		const type = (name) => columns.find((c) => c.name === name).type.toLowerCase();
		assert.equal(type("purpose"), "varchar(16)");
		assert.equal(type("token_hash"), "varchar(64)");
		assert.equal(type("requested_ip"), "varchar(45)");

		const indexes = await knex.raw("pragma index_list(npmpro_password_token)");
		const byName = Object.fromEntries(indexes.map((i) => [i.name, i.unique === 1]));
		assert.equal(byName.npmpro_password_token_hash, true);
		assert.equal(byName.npmpro_password_token_user, false);

		const keys = await knex.raw("pragma foreign_key_list(npmpro_password_token)");
		assert.equal(keys.length, 1);
		assert.equal(keys[0].table, "user");
		assert.equal(keys[0].from, "user_id");
		assert.equal(keys[0].on_delete, "CASCADE");

		const [id] = await knex("user").insert({
			created_on: NOW,
			modified_on: NOW,
			name: "u",
			nickname: "u",
			avatar: "",
			email: "u@example.com",
			roles: "[]",
		});
		const row = { user_id: id, purpose: "reset", token_hash: "a".repeat(64), created_on: NOW, expires_on: NOW };
		await knex("npmpro_password_token").insert(row);
		await assert.rejects(knex("npmpro_password_token").insert({ ...row, user_id: id }));
		const stored = await knex("npmpro_password_token").first();
		assert.equal(stored.used_on, null);
		assert.equal(stored.requested_ip, null);

		await up(knex);
		assert.equal((await knex("npmpro_password_token").count({ count: "*" }))[0].count, 1);

		// the foreign key deletes the tokens with their user
		await knex("user").where({ id }).del();
		assert.equal((await knex("npmpro_password_token").count({ count: "*" }))[0].count, 0);
	} finally {
		await db.cleanup();
	}
});
