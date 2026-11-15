import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261115120000_crowdsec_admin_ui.js";
import { crowdsecAdminUiTests } from "./support/crowdsec-admin-ui.js";

// 20261115120000_crowdsec_admin_ui on SQLite; test/crowdsec-admin-ui-servers.test.js runs the same on Postgres and MySQL
const ctx = {};

before(async () => {
	ctx.knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await ctx.knex.schema.createTable("setting", (table) => {
		table.string("id").primary();
		table.string("name").notNull();
		table.string("description").notNull();
		table.string("value").notNull();
		table.json("meta").notNull();
	});
});
after(() => ctx.knex?.destroy());

crowdsecAdminUiTests(ctx);

// only SQLite stores a meta that is no JSON (Postgres and MySQL refuse it in a json column)
it("leaves a crowdsec meta that is no JSON as it is and does not stop the start", async () => {
	await ctx.knex("setting").del();
	await ctx
		.knex("setting")
		.insert({ id: "crowdsec", name: "crowdsec", description: "", value: "", meta: "{not json" });
	await up(ctx.knex);
	const row = await ctx.knex("setting").where("id", "crowdsec").first("meta");
	assert.equal(row.meta, "{not json");
});
