import { after, before, describe } from "node:test";
import knexFactory from "knex";
import { oidcLinkTests } from "./support/oidc-identity.js";
import { ENGINES, resetEngine } from "./support/servers.js";

// The identity index of 20261112120000_oidc_identity_link on the real database servers. A file of its own (see
// traffic-totals-servers.test.js): the API tests on the servers load their database settings once.
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`OIDC identity link on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("user", (table) => {
				table.increments().primary();
				table.string("email").notNull();
				table.string("name").notNull();
			});
		});
		after(() => ctx.knex?.destroy());

		oidcLinkTests(ctx);
	});
}
