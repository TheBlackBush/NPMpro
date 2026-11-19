import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { ENGINES, resetEngine } from "./support/servers.js";

// 20261119120000_acme_accounts on the real database servers: the table, a 255 character unique server, the default state
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`ACME accounts on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			const { up } = await import("../migrations/20261119120000_acme_accounts.js");
			await up(ctx.knex);
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("stores a 255 character server, refuses a duplicate and defaults the state", async () => {
			const server = `https://${"a".repeat(247)}`;
			assert.equal(server.length, 255);
			const row = { server, created_on: "2026-11-19 10:00:00", modified_on: "2026-11-19 10:00:00" };
			await ctx.knex("npmpro_acme_account").insert(row);
			await assert.rejects(ctx.knex("npmpro_acme_account").insert(row));
			const stored = await ctx.knex("npmpro_acme_account").where({ server }).first();
			assert.equal(stored.state, "pending");
		});
	});
}
