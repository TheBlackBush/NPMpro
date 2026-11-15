import { after, before, describe } from "node:test";
import knexFactory from "knex";
import { crowdsecAdminUiTests } from "./support/crowdsec-admin-ui.js";
import { ENGINES, resetEngine } from "./support/servers.js";

// 20261115120000_crowdsec_admin_ui on the real database servers, where a JSON column comes back as an object or a
// string. A file of its own (see traffic-totals-servers.test.js): the API tests on the servers load their database
// settings once.
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`CrowdSec admin UI migration on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
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
	});
}
