import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { runMigrations } from "../lib/database/schema.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const NOW = "2026-11-29 10:00:00";

// 20261129120000_access_list_countries on the real database servers: the migration runs through the whole chain, the
// (list, country) pair is unique, the defaults are filled and a rerun changes nothing
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`Access list country rules on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await runMigrations(ctx.knex);
			await ctx
				.knex("access_list")
				.insert({ created_on: NOW, modified_on: NOW, owner_user_id: 1, name: "l", meta: "{}" });
			const { up } = await import("../migrations/20261129120000_access_list_countries.js");
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("fills the defaults of an existing list and of a new rule", async () => {
			const { knex } = ctx;
			const list = await knex("access_list").first();
			assert.equal(list.npmpro_geo_mode, "off");
			assert.equal(list.npmpro_geo_unknown, "auto");
			assert.equal(Number(list.npmpro_geo_drop), 0);
			await knex("npmpro_access_list_country").insert({
				created_on: NOW,
				modified_on: NOW,
				access_list_id: list.id,
				country: "DE",
			});
			assert.equal((await knex("npmpro_access_list_country").first()).npmpro_comment, "");
		});

		it("refuses the same country twice in one list and keeps its rows after a rerun", async () => {
			const { knex } = ctx;
			const { up } = await import("../migrations/20261129120000_access_list_countries.js");
			const list = await knex("access_list").first();
			const row = { created_on: NOW, modified_on: NOW, access_list_id: list.id, country: "DE" };
			await assert.rejects(knex("npmpro_access_list_country").insert(row));
			await knex("npmpro_access_list_country").insert({ ...row, country: "FR" });
			await up(knex);
			assert.equal(Number((await knex("npmpro_access_list_country").count({ count: "*" }))[0].count), 2);
		});
	});
}
