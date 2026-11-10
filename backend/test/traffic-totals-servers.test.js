import { after, before, describe } from "node:test";
import knexFactory from "knex";
import { up as upMonitoring } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";
import { up as upIndexes } from "../migrations/20261026110000_traffic_indexes.js";
import { ENGINES, resetEngine } from "./support/servers.js";
import { trafficTotalTests } from "./support/traffic-totals.js";

// The all-hosts traffic totals on the real database servers. A file of its own: servers-postgres.test.js and
// servers-mysql.test.js start the API, whose modules read their database settings when they load.
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	// biome-ignore lint/correctness/usePlaywrightValidDescribeCallback: node:test takes its options as the second argument
	describe(`traffic totals on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await upMonitoring(ctx.knex);
			await upVisitors(ctx.knex);
			await upIndexes(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		trafficTotalTests(ctx);
	});
}
