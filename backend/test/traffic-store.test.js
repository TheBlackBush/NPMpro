import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { createStore } from "../lib/traffic/store.js";
import { up } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";

const NOW = Date.UTC(2026, 9, 24, 12, 30, 0);
const MIN = Math.floor(NOW / 60000);

const setup = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await up(knex);
	await upVisitors(knex);
	return { knex, store: createStore(knex) };
};

const m = (bucket, status_class, requests, bytes = 10, host = "a") => ({ bucket, host, status_class, requests, bytes });

it("flush adds to existing rows and queries fill the series", async () => {
	const { knex, store } = await setup();
	await store.flush({ minutes: [m(MIN, "2xx", 2), m(MIN, "5xx", 1)] });
	await store.flush({
		minutes: [m(MIN, "2xx", 3)],
		countries: [{ bucket: Math.floor(NOW / 3600000), host: "a", country: "DE", requests: 4 }],
		asns: [{ bucket: Math.floor(NOW / 3600000), host: "a", asn: 64500, asn_name: "Net", requests: 4 }],
		ips: [{ bucket: Math.floor(NOW / 3600000), host: "a", ip: "1.2.3.4", requests: 4 }],
	});
	const r = await store.queryTraffic({ range: "1h", host: "", showIps: true, now: NOW });
	assert.deepEqual(r.totals, { requests: 6, bytes: 30, error_rate: 1 / 6 });
	assert.equal(r.series.length, 60);
	assert.equal(r.series.at(-1).by_class["2xx"], 5);
	assert.deepEqual(r.top_countries, [{ country: "DE", requests: 4 }]);
	assert.deepEqual(r.top_asns, [{ asn: 64500, asn_name: "Net", requests: 4 }]);
	assert.deepEqual(r.top_ips, [{ ip: "1.2.3.4", requests: 4 }]);
	assert.deepEqual(r.countries, { DE: 4 });
	const none = await store.queryTraffic({ range: "7d", host: "b", now: NOW });
	assert.equal(none.totals.requests, 0);
	assert.deepEqual(none.top_ips, []);
	await knex.destroy();
});

it("rolls old minutes into hours, keeps totals and prunes by retention", async () => {
	const { knex, store } = await setup();
	const old = MIN - 25 * 60;
	await store.flush({ minutes: [m(old, "2xx", 2), m(MIN, "2xx", 1)] });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	assert.equal((await knex("traffic_minute")).length, 1);
	assert.equal(Number((await knex("traffic_hour"))[0].requests), 2);
	assert.equal((await store.queryTraffic({ range: "7d", now: NOW })).totals.requests, 3);
	await store.rollUpAndPrune({ now: NOW + 31 * 86400000, retentionDays: 30 });
	assert.equal((await knex("traffic_hour")).length, 0);
	await knex.destroy();
});

it("summary reports today and deleteIps clears the ip table", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({
		minutes: [m(MIN, "2xx", 3), m(MIN, "4xx", 1)],
		countries: [{ bucket: hour, host: "a", country: "FR", requests: 3 }],
		ips: [{ bucket: hour, host: "a", ip: "1.1.1.1", requests: 1 }],
	});
	const s = await store.summary({ now: NOW });
	assert.equal(s.requests_today, 4);
	assert.equal(s.error_rate_today, 0.25);
	assert.equal(s.top_country_today, "FR");
	assert.equal(s.series_24h.length, 24);
	await store.deleteIps();
	assert.equal((await knex("traffic_ip_hour")).length, 0);
	await knex.destroy();
});

const HOUR_NOW = Math.floor(NOW / 3600000);

it("flushes 1500 ip rows twice in batches and sums them", async () => {
	const { knex, store } = await setup();
	const ips = Array.from({ length: 1500 }, (_, i) => ({
		bucket: HOUR_NOW,
		host: "a",
		ip: `10.0.${Math.floor(i / 250)}.${i % 250}`,
		requests: 2,
	}));
	await store.flush({ ips });
	await store.flush({ ips: ips.map((r) => ({ ...r })) });
	const rows = await knex("traffic_ip_hour");
	assert.equal(rows.length, 1500);
	assert.ok(rows.every((r) => Number(r.requests) === 4));
	await knex.destroy();
});

it("prune empties all four hour tables past the retention", async () => {
	const { knex, store } = await setup();
	const bucket = HOUR_NOW - 40 * 24;
	await store.flush({
		countries: [{ bucket, host: "a", country: "DE", requests: 1 }],
		asns: [{ bucket, host: "a", asn: 1, asn_name: "x", requests: 1 }],
		ips: [{ bucket, host: "a", ip: "1.1.1.1", requests: 1 }],
	});
	await knex("traffic_hour").insert({ bucket, host: "a", status_class: "2xx", requests: 1, bytes: 1 });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	for (const t of ["traffic_hour", "traffic_country_hour", "traffic_asn_hour", "traffic_ip_hour"]) {
		assert.equal((await knex(t)).length, 0, t);
	}
	await knex.destroy();
});

it("counts a stored hour row and unrolled minutes of another hour once, and folds a roll-up into an existing hour", async () => {
	const { knex, store } = await setup();
	const oldMinute = MIN - 25 * 60;
	const oldHour = Math.floor(oldMinute / 60);
	await knex("traffic_hour").insert({ bucket: oldHour, host: "a", status_class: "2xx", requests: 5, bytes: 50 });
	await store.flush({ minutes: [m(oldMinute, "2xx", 2, 20), m(MIN, "2xx", 1, 10)] });
	// unrolled old minutes plus the stored hour row: both count
	assert.equal((await store.queryTraffic({ range: "7d", now: NOW })).totals.requests, 8);
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const hours = await knex("traffic_hour");
	assert.equal(hours.length, 1);
	assert.equal(Number(hours[0].requests), 7);
	assert.equal(Number(hours[0].bytes), 70);
	assert.equal((await store.queryTraffic({ range: "7d", now: NOW })).totals.requests, 8);
	await knex.destroy();
});

it("filters by host and hides ips unless showIps", async () => {
	const { knex, store } = await setup();
	await store.flush({
		minutes: [m(MIN, "2xx", 2, 10, "a"), m(MIN, "2xx", 5, 10, "b")],
		ips: [{ bucket: HOUR_NOW, host: "a", ip: "1.1.1.1", requests: 2 }],
	});
	const a = await store.queryTraffic({ range: "24h", host: "a", showIps: false, now: NOW });
	assert.equal(a.totals.requests, 2);
	assert.deepEqual(
		a.hosts.map((h) => h.host),
		["a"],
	);
	assert.deepEqual(a.top_ips, []);
	assert.equal((await store.queryTraffic({ range: "24h", now: NOW })).totals.requests, 7);
	await knex.destroy();
});

it("summary counts only the UTC day so far across midnight", async () => {
	const { knex, store } = await setup();
	const now = Date.UTC(2026, 9, 25, 0, 30, 0);
	const minute = Math.floor(now / 60000);
	await store.flush({ minutes: [m(minute - 60, "2xx", 4), m(minute, "5xx", 1)] });
	const s = await store.summary({ now });
	assert.equal(s.requests_today, 1);
	assert.equal(s.error_rate_today, 1);
	assert.equal(
		s.series_24h.reduce((n, p) => n + p.requests, 0),
		5,
	);
	await knex.destroy();
});

const DAYN = Math.floor(NOW / 86400000);
const v = (day, host, hash) => ({ day, host, hash });

it("creates the visitor table with its indexes", async () => {
	const { knex } = await setup();
	const names = (await knex.raw("PRAGMA index_list(traffic_visitor)")).map((r) => r.name);
	assert.ok(names.includes("tv_uq"));
	assert.ok(names.includes("tv_day"));
	await knex.destroy();
});

it("ignores duplicate visitor rows, also across flushes", async () => {
	const { knex, store } = await setup();
	await store.flush({ visitors: [v(DAYN, "a", "h1"), v(DAYN, "a", "h1"), v(DAYN, "a", "")] });
	await store.flush({ visitors: [v(DAYN, "a", "h1"), v(DAYN, "a", "h2"), v(DAYN, "a", "")] });
	assert.equal((await knex("traffic_visitor")).length, 3);
	await knex.destroy();
});

it("counts distinct visitors over days and hosts and reports the cap marker", async () => {
	const { knex, store } = await setup();
	await store.flush({
		visitors: [
			v(DAYN, "a", "h1"),
			v(DAYN, "b", "h1"),
			v(DAYN - 1, "a", "h2"),
			v(DAYN - 5, "a", "h3"),
			v(DAYN, "b", ""),
		],
	});
	assert.deepEqual(await store.countVisitors({ startDay: DAYN - 1, hosts: ["a", "b"] }), {
		visitors: 2,
		capped: true,
	});
	assert.deepEqual(await store.countVisitors({ startDay: DAYN - 1, hosts: ["a"] }), { visitors: 2, capped: false });
	assert.deepEqual(await store.countVisitors({ startDay: DAYN, hosts: null }), { visitors: 1, capped: true });
	assert.deepEqual(await store.countVisitors({ startDay: DAYN - 9, hosts: null }), { visitors: 3, capped: true });
	assert.deepEqual(await store.countVisitors({ startDay: DAYN, hosts: [] }), { visitors: 0, capped: false });
	await knex.destroy();
});

it("prunes old visitor days and deleteVisitors empties the table", async () => {
	const { knex, store } = await setup();
	await store.flush({ visitors: [v(DAYN - 31, "a", "old"), v(DAYN - 30, "a", "edge"), v(DAYN, "a", "new")] });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	assert.deepEqual(
		(await knex("traffic_visitor").orderBy("day")).map((r) => r.hash),
		["edge", "new"],
	);
	await store.deleteVisitors();
	assert.equal((await knex("traffic_visitor")).length, 0);
	await knex.destroy();
});

it("filters traffic by a list of host keys", async () => {
	const { knex, store } = await setup();
	await store.flush({ minutes: [m(MIN, "2xx", 2, 10, "a"), m(MIN, "2xx", 3, 10, "b"), m(MIN, "2xx", 4, 10, "c")] });
	assert.equal((await store.queryTraffic({ range: "1h", host: ["a", "b"], now: NOW })).totals.requests, 5);
	assert.equal((await store.queryTraffic({ range: "1h", host: [], now: NOW })).totals.requests, 0);
	assert.equal((await store.queryTraffic({ range: "1h", host: "c", now: NOW })).totals.requests, 4);
	await knex.destroy();
});

it("visitorDayHashes gives the stored hashes and the marker per day and host for the given days", async () => {
	const { knex, store } = await setup();
	const day = Math.floor(NOW / 86400000);
	const hx = (n) => n.toString(16).padStart(32, "0");
	await store.flush({
		minutes: [],
		visitors: [
			{ day, host: "a", hash: hx(1) },
			{ day, host: "a", hash: hx(2) },
			{ day, host: "a", hash: "" },
			{ day, host: "b", hash: hx(1) },
			{ day: day - 1, host: "a", hash: hx(1) },
			{ day: day - 2, host: "a", hash: hx(1) },
		],
	});
	const rows = await store.visitorDayHashes({ days: [day - 1, day] });
	assert.deepEqual(
		rows
			.sort((x, y) => x.day - y.day || x.host.localeCompare(y.host))
			.map((r) => ({ ...r, hashes: r.hashes.sort((x, y) => x.localeCompare(y)) })),
		[
			{ day: day - 1, host: "a", hashes: [hx(1)], capped: false },
			{ day, host: "a", hashes: [hx(1), hx(2)], capped: true },
			{ day, host: "b", hashes: [hx(1)], capped: false },
		],
	);
	await knex.destroy();
});

it("deleteAll empties every traffic table", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({
		minutes: [m(MIN, "2xx", 2), m(MIN - 25 * 60, "2xx", 1)],
		countries: [{ bucket: hour, host: "a", country: "DE", requests: 1 }],
		asns: [{ bucket: hour, host: "a", asn: 64500, asn_name: "Net", requests: 1 }],
		ips: [{ bucket: hour, host: "a", ip: "1.2.3.4", requests: 1 }],
		visitors: [{ day: Math.floor(NOW / 86400000), host: "a", hash: "abc" }],
	});
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const tables = [
		"traffic_minute",
		"traffic_hour",
		"traffic_country_hour",
		"traffic_asn_hour",
		"traffic_ip_hour",
		"traffic_visitor",
	];
	for (const table of tables) assert.ok((await knex(table)).length > 0, table);
	await store.deleteAll();
	for (const table of tables) assert.equal((await knex(table)).length, 0, table);
	assert.equal((await store.queryTraffic({ range: "30d", now: NOW })).totals.requests, 0);
	// later counts start from zero
	await store.flush({ minutes: [m(MIN, "2xx", 3)] });
	assert.equal((await store.queryTraffic({ range: "1h", now: NOW })).totals.requests, 3);
	await knex.destroy();
});
