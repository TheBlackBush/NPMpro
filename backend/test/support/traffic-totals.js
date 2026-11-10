import assert from "node:assert/strict";
import { it } from "node:test";
import { createStore } from "../../lib/traffic/store.js";
import { up as upTotals } from "../../migrations/20261110120000_traffic_totals.js";

// The all-hosts traffic (host "*") against the sum of every host's rows, on each database engine. The list of every
// host key reads the per-host rows only, as the all-hosts view read them before the totals existed.
// ctx.knex: a database with the traffic tables (the three monitoring migrations).

const NOW = Date.UTC(2026, 10, 10, 12, 30, 0);
const MIN = Math.floor(NOW / 60000);
const HOUR = Math.floor(NOW / 3600000);
const DAY_MIN = 24 * 60;
const HOSTS = ["a.example.com", "b.example.com", "_other"];
const RANGES = ["1h", "24h", "7d", "30d"];

const m = (bucket, host, status_class, requests) => ({ bucket, host, status_class, requests, bytes: requests * 100 });

// every total distinct, so the lists sorted by requests have one order on every engine
const FIRST = {
	minutes: [
		m(MIN - 5, "a.example.com", "2xx", 7),
		m(MIN - 5, "b.example.com", "2xx", 3),
		m(MIN - 30, "a.example.com", "5xx", 2),
		m(MIN - 30, "_other", "4xx", 1),
		m(MIN - 120, "b.example.com", "2xx", 11),
		m(MIN - 26 * 60, "a.example.com", "2xx", 13),
		m(MIN - 26 * 60, "b.example.com", "3xx", 17),
		m(MIN - 3 * DAY_MIN, "a.example.com", "2xx", 19),
		m(MIN - 10 * DAY_MIN, "_other", "2xx", 23),
	],
	countries: [
		{ bucket: HOUR - 1, host: "a.example.com", country: "DE", requests: 5 },
		{ bucket: HOUR - 1, host: "b.example.com", country: "DE", requests: 4 },
		{ bucket: HOUR - 1, host: "b.example.com", country: "FR", requests: 3 },
		{ bucket: HOUR - 200, host: "a.example.com", country: "US", requests: 6 },
		{ bucket: HOUR - 2, host: "_other", country: "--", requests: 1 },
	],
	asns: [
		{ bucket: HOUR - 1, host: "a.example.com", asn: 64500, asn_name: "Net A", requests: 5 },
		{ bucket: HOUR - 1, host: "b.example.com", asn: 64500, asn_name: "Net A", requests: 2 },
		{ bucket: HOUR - 1, host: "b.example.com", asn: 64501, asn_name: "Net B", requests: 4 },
		{ bucket: HOUR - 300, host: "a.example.com", asn: 0, asn_name: "Other", requests: 1 },
	],
	ips: [
		{ bucket: HOUR - 1, host: "a.example.com", ip: "10.0.0.1", requests: 6 },
		{ bucket: HOUR - 1, host: "b.example.com", ip: "10.0.0.1", requests: 2 },
		{ bucket: HOUR - 1, host: "b.example.com", ip: "10.0.0.2", requests: 3 },
		{ bucket: HOUR - 2, host: "_other", ip: "other", requests: 1 },
	],
};
// a second flush that adds to stored rows (the "*" rows are updated, not inserted again)
const SECOND = {
	minutes: [m(MIN - 5, "a.example.com", "2xx", 1), m(MIN - 3 * DAY_MIN, "b.example.com", "2xx", 29)],
	countries: [{ bucket: HOUR - 1, host: "a.example.com", country: "DE", requests: 2 }],
	asns: [],
	ips: [],
};

const sameAsHostSums = async (store) => {
	for (const range of RANGES) {
		const all = await store.queryTraffic({ range, host: "", showIps: true, now: NOW });
		const each = await store.queryTraffic({ range, host: HOSTS, showIps: true, now: NOW });
		assert.deepEqual(all, each, range);
	}
};

const totalRows = async (knex) =>
	Number((await knex("traffic_hour").where("host", "*").count({ n: "*" }))[0].n) +
	Number((await knex("traffic_minute").where("host", "*").count({ n: "*" }))[0].n);

export const trafficTotalTests = (ctx) => {
	it("the all-hosts traffic equals the sum of every host, after two flushes and the roll-up", async () => {
		const store = createStore(ctx.knex);
		await store.deleteAll();
		await store.flush(FIRST);
		await store.flush(SECOND);
		await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
		await sameAsHostSums(store);
		// today (UTC) so far: the minute rows of 12:25, 12:00 and 10:30
		assert.equal((await store.summary({ now: NOW })).requests_today, 25);
		const thirty = await store.queryTraffic({ range: "30d", host: "", showIps: true, now: NOW });
		assert.equal(thirty.totals.requests, 126);
		assert.deepEqual(
			thirty.hosts.map(({ host, requests }) => [host, requests]),
			[
				["b.example.com", 60],
				["a.example.com", 42],
				["_other", 24],
			],
		);
	});

	it("the backfill writes the totals of rows stored before it, and a second run changes nothing", async () => {
		const store = createStore(ctx.knex);
		await store.deleteAll();
		// rows as the flush wrote them before the totals, an ASN under two names in one hour
		await ctx.knex("traffic_hour").insert([
			{ bucket: HOUR - 50, host: "a.example.com", status_class: "2xx", requests: 5, bytes: 50 },
			{ bucket: HOUR - 50, host: "b.example.com", status_class: "2xx", requests: 3, bytes: 30 },
			{ bucket: HOUR - 400, host: "b.example.com", status_class: "4xx", requests: 2, bytes: 20 },
		]);
		await ctx.knex("traffic_minute").insert([
			{ bucket: MIN - 10, host: "a.example.com", status_class: "2xx", requests: 4, bytes: 40 },
			{ bucket: MIN - 10, host: "_other", status_class: "5xx", requests: 1, bytes: 10 },
		]);
		await ctx.knex("traffic_country_hour").insert([
			{ bucket: HOUR - 50, host: "a.example.com", country: "DE", requests: 5 },
			{ bucket: HOUR - 50, host: "b.example.com", country: "DE", requests: 3 },
			{ bucket: HOUR - 400, host: "b.example.com", country: "FR", requests: 2 },
		]);
		await ctx.knex("traffic_asn_hour").insert([
			{ bucket: HOUR - 50, host: "a.example.com", asn: 64500, asn_name: "Net A", requests: 5 },
			{ bucket: HOUR - 50, host: "b.example.com", asn: 64500, asn_name: "Net B", requests: 3 },
			{ bucket: HOUR - 400, host: "b.example.com", asn: 64501, asn_name: "Net C", requests: 2 },
		]);
		await ctx.knex("traffic_ip_hour").insert([
			{ bucket: HOUR - 50, host: "a.example.com", ip: "10.0.0.1", requests: 5 },
			{ bucket: HOUR - 50, host: "b.example.com", ip: "10.0.0.1", requests: 3 },
			{ bucket: HOUR - 400, host: "b.example.com", ip: "10.0.0.2", requests: 2 },
		]);
		await upTotals(ctx.knex);
		await sameAsHostSums(store);
		const first = await totalRows(ctx.knex);
		assert.equal(first, 4);
		await upTotals(ctx.knex);
		assert.equal(await totalRows(ctx.knex), first);
		await sameAsHostSums(store);
		const thirty = await store.queryTraffic({ range: "30d", host: "", showIps: true, now: NOW });
		assert.deepEqual(thirty.top_asns[0], { asn: 64500, asn_name: "Net B", requests: 8 });
	});
};
