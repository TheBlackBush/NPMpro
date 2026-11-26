import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261127120000_user_language.js";
import { ENGINES, resetEngine } from "./support/servers.js";

// 20261127120000_user_language on the real database servers: the column is added once, a rerun is harmless and old
// rows read null. A file of its own (see oidc-identity-servers.test.js).
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`User language on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("user", (table) => {
				table.increments().primary();
				table.string("email").notNull();
			});
			await ctx.knex("user").insert({ email: "old@example.com" });
		});
		after(() => ctx.knex?.destroy());

		it("adds the nullable column, keeps old rows null and stores a code; a rerun is harmless", async () => {
			const { knex } = ctx;
			await up(knex);
			await up(knex);
			assert.equal((await knex("user").first()).npmpro_language, null);
			await knex("user").update({ npmpro_language: "uk" });
			assert.equal((await knex("user").first()).npmpro_language, "uk");
			await assert.rejects(knex("user").update({ npmpro_language: "123456789" }));
		});
	});
}
