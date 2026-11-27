import assert from "node:assert/strict";
import { it } from "node:test";
import { up } from "../migrations/20261128120000_webhooks.js";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-28 10:00:00";

// 20261128120000_webhooks on SQLite; the Postgres and MySQL checks are in test/notify-servers.test.js
it("creates npmpro_webhook with its columns, defaults and unique name, and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		const columns = await knex.raw("pragma table_info(npmpro_webhook)");
		assert.deepEqual(
			columns.map((c) => c.name),
			[
				"id",
				"created_on",
				"modified_on",
				"name",
				"url",
				"url_hint",
				"secret",
				"previous_secret",
				"previous_secret_until",
				"events",
				"enabled",
				"verify_tls",
				"disabled_reason",
				"failing_since",
				"last_success_on",
			],
		);
		const type = (name) => columns.find((c) => c.name === name).type.toLowerCase();
		assert.equal(type("name"), "varchar(100)");
		assert.equal(type("url_hint"), "varchar(253)");
		assert.equal(type("disabled_reason"), "varchar(16)");
		assert.equal(type("url"), "text");

		const indexes = await knex.raw("pragma index_list(npmpro_webhook)");
		assert.equal(indexes.find((i) => i.name === "npmpro_webhook_name").unique, 1);

		const row = {
			created_on: NOW,
			modified_on: NOW,
			name: "w",
			url: "sealed",
			url_hint: "https://example.com",
			secret: "sealed",
			events: '["*"]',
		};
		await knex("npmpro_webhook").insert(row);
		await assert.rejects(knex("npmpro_webhook").insert(row));
		const stored = await knex("npmpro_webhook").first();
		assert.equal(Number(stored.enabled), 1);
		assert.equal(Number(stored.verify_tls), 1);
		for (const key of [
			"previous_secret",
			"previous_secret_until",
			"disabled_reason",
			"failing_since",
			"last_success_on",
		]) {
			assert.equal(stored[key], null, key);
		}

		await up(knex);
		assert.equal((await knex("npmpro_webhook").count({ count: "*" }))[0].count, 1);
	} finally {
		await db.cleanup();
	}
});
