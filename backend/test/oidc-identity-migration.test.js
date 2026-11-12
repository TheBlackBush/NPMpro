import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import knexFactory from "knex";
import { oidcLinkTests } from "./support/oidc-identity.js";

// 20261112120000_oidc_identity_link on SQLite; test/oidc-identity-servers.test.js runs the same on Postgres and MySQL
const ctx = {};

before(async () => {
	ctx.knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await ctx.knex.schema.createTable("user", (table) => {
		table.increments().primary();
		table.string("email").notNull();
		table.string("name").notNull();
	});
});
after(() => ctx.knex?.destroy());

oidcLinkTests(ctx);

it("names the identity index", async () => {
	const names = (await ctx.knex("sqlite_master").where("type", "index").select("name")).map(({ name }) => name);
	assert.ok(names.includes("npmpro_user_oidc_identity"));
});
