import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261113120000_landing_pages.js";

// 20261113120000_landing_pages on SQLite; the real-server step of CI runs every migration on MySQL and Postgres
const ctx = {};

before(async () => {
	ctx.knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
	for (const name of ["proxy_host", "dead_host", "access_list"]) {
		await ctx.knex.schema.createTable(name, (table) => {
			table.increments().primary();
			table.string("name").notNull().defaultTo("");
		});
		await ctx.knex(name).insert({ name: "before" });
	}
});
after(() => ctx.knex?.destroy());

it("adds the page columns with their defaults, and runs twice", async () => {
	await up(ctx.knex);
	await up(ctx.knex);
	assert.deepEqual(await ctx.knex("proxy_host").first(), {
		id: 1,
		name: "before",
		npmpro_maintenance: 0,
		npmpro_page_not_found: "upstream",
		npmpro_page_not_found_html: null,
		npmpro_page_upstream: "global",
		npmpro_page_upstream_html: null,
		npmpro_page_maintenance: "global",
		npmpro_page_maintenance_html: null,
	});
	assert.deepEqual(await ctx.knex("dead_host").first(), {
		id: 1,
		name: "before",
		npmpro_page: "global",
		npmpro_page_html: null,
	});
	assert.deepEqual(await ctx.knex("access_list").first(), {
		id: 1,
		name: "before",
		npmpro_denied_page: "global",
		npmpro_denied_page_html: null,
	});
});
