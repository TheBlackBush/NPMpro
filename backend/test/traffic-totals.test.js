import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { createHostMapper } from "../lib/traffic/host-list.js";
import { up as upMonitoring } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";
import { up as upIndexes } from "../migrations/20261026110000_traffic_indexes.js";
import { down, up as upTotals } from "../migrations/20261110120000_traffic_totals.js";
import { trafficTotalTests } from "./support/traffic-totals.js";

const ctx = {};

// biome-ignore lint/correctness/usePlaywrightValidDescribeCallback: node:test takes its options as the second argument
describe("traffic totals on SQLite", () => {
	before(async () => {
		ctx.knex = knexFactory({
			client: "better-sqlite3",
			connection: { filename: ":memory:" },
			useNullAsDefault: true,
		});
		await upMonitoring(ctx.knex);
		await upVisitors(ctx.knex);
		await upIndexes(ctx.knex);
	});
	after(() => ctx.knex?.destroy());

	trafficTotalTests(ctx);
});

it("a domain name that is only * is not a host key: the totals own it", () => {
	const map = createHostMapper(["*", "a.example.com"]);
	assert.equal(map("*"), "_other");
	assert.equal(map("a.example.com"), "a.example.com");
	assert.equal(map.keys.has("*"), false);
});

describe("the traffic totals migration", () => {
	it("writes nothing on empty tables, and skips a table that does not exist", async () => {
		const knex = knexFactory({
			client: "better-sqlite3",
			connection: { filename: ":memory:" },
			useNullAsDefault: true,
		});
		await upMonitoring(knex);
		await upTotals(knex);
		assert.equal((await knex("traffic_hour").count({ n: "*" }))[0].n, 0);
		await knex.schema.dropTable("traffic_ip_hour");
		await upTotals(knex);
		await knex.destroy();
	});

	it("can not be migrated down", () => {
		assert.throws(() => down(), /can't migrate down/u);
	});
});
