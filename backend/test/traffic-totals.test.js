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

describe("the traffic totals backfill with stray buckets", () => {
	it("jumps over the empty buckets, so a bucket 0 and a far future one cost a batch each", async () => {
		const knex = knexFactory({
			client: "better-sqlite3",
			connection: { filename: ":memory:" },
			useNullAsDefault: true,
		});
		await upMonitoring(knex);
		await upVisitors(knex);
		await upIndexes(knex);
		const now = Math.floor(Date.UTC(2026, 10, 10, 12) / 60000);
		await knex("traffic_minute").insert(
			[0, now, now * 3].flatMap((bucket) => [
				{ bucket, host: "a.example.com", status_class: "2xx", requests: 2, bytes: 20 },
				{ bucket, host: "b.example.com", status_class: "2xx", requests: 3, bytes: 30 },
			]),
		);
		const start = Date.now();
		await upTotals(knex);
		assert.ok(Date.now() - start < 5000);
		const totals = await knex("traffic_minute").where("host", "*").orderBy("bucket");
		assert.deepEqual(
			totals.map((row) => [Number(row.bucket), Number(row.requests), Number(row.bytes)]),
			[0, now, now * 3].map((bucket) => [bucket, 5, 50]),
		);
		await upTotals(knex);
		assert.equal((await knex("traffic_minute").where("host", "*")).length, 3);
		await knex.destroy();
	});
});
