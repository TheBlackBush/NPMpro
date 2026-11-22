import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { ENGINES, resetEngine } from "./support/servers.js";

// 20261120120000_certificate_acme_server on the real database servers: added twice, a 255 character URL
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`Certificate CA column on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("certificate", (table) => {
				table.increments().primary();
			});
			const { up } = await import("../migrations/20261120120000_certificate_acme_server.js");
			await up(ctx.knex);
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("stores a 255 character CA and defaults to null", async () => {
			const server = `https://${"a".repeat(247)}`;
			assert.equal(server.length, 255);
			await ctx.knex("certificate").insert({ npmpro_acme_server: server });
			await ctx.knex("certificate").insert({});
			const stored = await ctx.knex("certificate").where({ npmpro_acme_server: server });
			assert.equal(stored.length, 1);
			const empty = await ctx.knex("certificate").whereNull("npmpro_acme_server");
			assert.equal(empty.length, 1);
		});
	});
}
