import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { ENGINES, resetEngine } from "./support/servers.js";

const NOW = "2026-11-23 10:00:00";

// 20261123120000_dns_domains on the real database servers: a 253 character name in the unique index, the foreign
// key, ON DELETE CASCADE and a rerun
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`DNS domains on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("npmpro_dns_credential", (table) => {
				table.increments().primary();
				table.dateTime("created_on").notNull();
				table.dateTime("modified_on").notNull();
				table.integer("owner_user_id").notNull().unsigned();
				table.string("name", 255).notNull();
				table.string("provider", 255).notNull();
				table.text("values").notNull();
			});
			const { up } = await import("../migrations/20261123120000_dns_domains.js");
			await up(ctx.knex);
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("stores a 253 character name once per credential and removes the domains with their credential", async () => {
			const [inserted] = await ctx.knex("npmpro_dns_credential").insert(
				{
					created_on: NOW,
					modified_on: NOW,
					owner_user_id: 1,
					name: "c",
					provider: "cloudflare",
					values: "v1:x",
				},
				["id"],
			);
			const credentialId = typeof inserted === "object" ? inserted.id : inserted;
			const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
			assert.equal(domain.length, 253);
			const row = { created_on: NOW, modified_on: NOW, dns_credential_id: credentialId, name: domain };
			await ctx.knex("npmpro_dns_domain").insert(row);
			await assert.rejects(ctx.knex("npmpro_dns_domain").insert(row));
			await assert.rejects(
				ctx.knex("npmpro_dns_domain").insert({ ...row, dns_credential_id: credentialId + 100 }),
			);
			await ctx.knex("npmpro_dns_credential").where({ id: credentialId }).del();
			assert.equal(Number((await ctx.knex("npmpro_dns_domain").count({ count: "*" }))[0].count), 0);
		});
	});
}
