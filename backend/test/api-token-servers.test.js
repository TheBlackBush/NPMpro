import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { ENGINES, resetEngine } from "./support/servers.js";

// 20261117120000_api_tokens on the real database servers: the table, the unique indexes, the bigint times past 2038
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`API tokens on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("audit_log", (table) => {
				table.increments().primary();
				table.string("action").notNull();
			});
			const { up } = await import("../migrations/20261117120000_api_tokens.js");
			await up(ctx.knex);
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("stores a token with a far expiry and refuses a second lookup id", async () => {
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
				created_on: 1_800_000_000,
				expires_on: 4_102_444_800,
			};
			await ctx.knex("npmpro_api_token").insert(row);
			await assert.rejects(ctx.knex("npmpro_api_token").insert({ ...row, name: "other" }));
			const stored = await ctx.knex("npmpro_api_token").first();
			assert.equal(Number(stored.expires_on), 4_102_444_800);
			assert.equal(Boolean(Number(stored.is_admin)), false);
			assert.equal(await ctx.knex.schema.hasColumn("audit_log", "npmpro_api_token_name"), true);
		});
	});
}
