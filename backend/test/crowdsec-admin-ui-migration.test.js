import { after, before } from "node:test";
import knexFactory from "knex";
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
