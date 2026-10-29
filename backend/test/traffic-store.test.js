import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { pathHash } from "../lib/traffic/path-hash.js";
import { createStore } from "../lib/traffic/store.js";
import { up } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";
import { up as upPaths } from "../migrations/20261029120000_traffic_paths.js";

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
	await upPaths(knex);
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
		paths: [{ bucket: hour, host: "a", path: "/x", requests: 1, last_seen: 1 }],
	});
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const tables = [
		"traffic_minute",
		"traffic_hour",
		"traffic_country_hour",
		"traffic_asn_hour",
		"traffic_ip_hour",
		"traffic_visitor",
		"traffic_path_hour",
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

const p = (path, requests, lastSeen, host = "a", bucket = Math.floor(NOW / 3600000)) => ({
	bucket,
	host,
	path,
	requests,
	last_seen: lastSeen,
});

it("stores missing paths per hour with the newest last_seen and lists the top paths of the range", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({ minutes: [], paths: [p("/x", 2, 100), p("/y", 1, 50)] });
	await store.flush({ minutes: [], paths: [p("/x", 3, 90), p("/x", 1, 120, "a", hour - 1)] });
	const rows = await knex("traffic_path_hour").orderBy(["bucket", "path"]);
	assert.deepEqual(
		rows.map((r) => [Number(r.bucket) - hour, r.path, Number(r.requests), Number(r.last_seen)]),
		[
			[-1, "/x", 1, 120],
			[0, "/x", 5, 100],
			[0, "/y", 1, 50],
		],
	);
	const r = await store.queryTraffic({ range: "24h", now: NOW, paths: true });
	assert.deepEqual(r.top_404_paths, [
		{ path: "/x", requests: 6, last_seen: new Date(120_000).toISOString() },
		{ path: "/y", requests: 1, last_seen: new Date(50_000).toISOString() },
	]);
	assert.equal("top_404_paths" in (await store.queryTraffic({ range: "24h", now: NOW })), false);
	await knex.destroy();
});

it("flushes path rows with set-based upserts: no select, one statement per 200 rows", async () => {
	const { knex, store } = await setup();
	const sql = [];
	knex.on("query", (q) => sql.push(q.sql.toLowerCase()));
	const many = Array.from({ length: 450 }, (_, i) => p(`/p${i}`, 1, 1));
	await store.flush({ minutes: [], paths: many });
	await store.flush({ minutes: [], paths: many });
	const pathSql = sql.filter((s) => s.includes("traffic_path_hour"));
	assert.equal(
		pathSql.some((s) => s.startsWith("select")),
		false,
	);
	assert.equal(pathSql.length, 6);
	const [{ n }] = await knex("traffic_path_hour").sum({ n: "requests" });
	assert.equal(Number(n), 900);
	await knex.destroy();
});

it("keeps the ten paths with the most requests, ties by path, for the selected host keys", async () => {
	const { knex, store } = await setup();
	const paths = Array.from({ length: 12 }, (_, i) => p(`/p${String(i).padStart(2, "0")}`, i < 2 ? 5 : 1, 1));
	await store.flush({ minutes: [], paths: [...paths, p("/other-host", 50, 1, "b"), p("(other)", 3, 1)] });
	const r = await store.queryTraffic({ range: "7d", host: ["a"], now: NOW, paths: true });
	assert.deepEqual(
		r.top_404_paths.map((row) => [row.path, row.requests]),
		[
			["/p00", 5],
			["/p01", 5],
			["(other)", 3],
			["/p02", 1],
			["/p03", 1],
			["/p04", 1],
			["/p05", 1],
			["/p06", 1],
			["/p07", 1],
			["/p08", 1],
		],
	);
	await knex.destroy();
});

it("rolls path rows of days before yesterday into one row per day, the 7d list stays the same", async () => {
	const { knex, store } = await setup();
	const today = Math.floor(NOW / 86400000);
	const rows = [];
	for (const d of [1, 2, 3]) {
		for (const h of [0, 5, 23]) rows.push(p("/x", 1, (today - d) * 86400 + h * 3600, "a", (today - d) * 24 + h));
	}
	rows.push(p("/y", 2, 7, "a", today * 24 + 1));
	await store.flush({ minutes: [], paths: rows });
	const before = await store.queryTraffic({ range: "7d", now: NOW, paths: true });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	// a second run folds nothing new
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const stored = await knex("traffic_path_hour").orderBy("bucket");
	assert.deepEqual(
		stored.map((r) => [Number(r.bucket) - today * 24, r.path, Number(r.requests)]),
		[
			[-72, "/x", 3],
			[-48, "/x", 1],
			[-43, "/x", 1],
			[-25, "/x", 1],
			[-24, "/x", 1],
			[-19, "/x", 1],
			[-1, "/x", 1],
			[1, "/y", 2],
		],
	);
	assert.equal(Number(stored[0].last_seen), (today - 3) * 86400 + 23 * 3600);
	assert.deepEqual(
		(await store.queryTraffic({ range: "7d", now: NOW, paths: true })).top_404_paths,
		before.top_404_paths,
	);
	await knex.destroy();
});

it("folds path hour rows of the 7 days before the fold window only; older hour rows still count", async () => {
	const { knex, store } = await setup();
	const today = Math.floor(NOW / 86400000);
	// the fold covers buckets from (today - 9) * 24 up to (today - 2) * 24
	const rows = [
		p("/in", 1, 10, "a", (today - 9) * 24 + 1),
		p("/in", 2, 20, "a", (today - 9) * 24 + 5),
		p("/in", 4, 30, "a", (today - 3) * 24 + 23),
		p("/out", 3, 40, "a", (today - 10) * 24 + 23),
		p("/out", 5, 50, "a", (today - 12) * 24 + 7),
	];
	await store.flush({ minutes: [], paths: rows });
	const before = await store.queryTraffic({ range: "30d", now: NOW, paths: true });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const stored = await knex("traffic_path_hour").orderBy(["bucket", "path"]);
	assert.deepEqual(
		stored.map((r) => [Number(r.bucket) - today * 24, r.path, Number(r.requests)]),
		[
			[-12 * 24 + 7, "/out", 5],
			[-10 * 24 + 23, "/out", 3],
			[-9 * 24, "/in", 3],
			[-3 * 24, "/in", 4],
		],
	);
	const after = await store.queryTraffic({ range: "30d", now: NOW, paths: true });
	assert.deepEqual(after.top_404_paths, before.top_404_paths);
	assert.deepEqual(
		after.top_404_paths.map((r) => [r.path, r.requests]),
		[
			["/out", 8],
			["/in", 7],
		],
	);
	await knex.destroy();
});

it("prunes path rows with the hour tables and deletePaths empties them", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({ minutes: [], paths: [p("/old", 1, 1, "a", hour - 31 * 24), p("/new", 1, 1)] });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	assert.deepEqual(
		(await knex("traffic_path_hour")).map((r) => r.path),
		["/new"],
	);
	await store.deletePaths();
	assert.equal((await knex("traffic_path_hour")).length, 0);
	await knex.destroy();
});

it("deletePaths deletes one week of buckets per statement", async () => {
	const { knex, store } = await setup();
	const hour = Math.floor(NOW / 3600000);
	await store.flush({
		minutes: [],
		paths: Array.from({ length: 60 }, (_, d) => p(`/d${d}`, 1, 1, "a", hour - d * 24)),
	});
	const deletes = [];
	knex.on("query", (q) => {
		if (q.sql.toLowerCase().startsWith("delete")) deletes.push(q.sql);
	});
	await store.deletePaths();
	assert.equal((await knex("traffic_path_hour")).length, 0);
	assert.ok(deletes.length >= 9, String(deletes.length));
	// an empty table needs no delete
	deletes.length = 0;
	await store.deletePaths();
	assert.equal(deletes.length, 0);
	await knex.destroy();
});

it("pathDayHashes gives the hashes of the stored paths per UTC day and host without (other)", async () => {
	const { knex, store } = await setup();
	const today = Math.floor(NOW / 86400000);
	await store.flush({
		minutes: [],
		paths: [
			p("/a", 1, 1, "a", today * 24 + 1),
			p("/a", 1, 1, "a", today * 24 + 5),
			p("/b", 1, 1, "a", today * 24 - 1),
			p("(other)", 1, 1, "a", today * 24 + 1),
			p("/c", 1, 1, "b", today * 24 - 30),
		],
	});
	const keys = await store.pathDayHashes({ days: [today - 1, today] });
	assert.deepEqual(
		keys.map((k) => [k.day - today, k.host, k.hashes]).sort((x, y) => x[0] - y[0]),
		[
			[-1, "a", [pathHash("/b")]],
			[0, "a", [pathHash("/a")]],
		],
	);
	await knex.destroy();
});

it("keeps paths that differ only in case or accents apart on SQLite", async () => {
	const { knex, store } = await setup();
	await store.flush({ minutes: [], paths: ["/Admin", "/admin", "/café", "/cafe"].map((path) => p(path, 1, 1)) });
	await store.flush({ minutes: [], paths: ["/Admin", "/admin"].map((path) => p(path, 1, 1)) });
	const rows = await knex("traffic_path_hour").orderBy("path");
	assert.deepEqual(
		rows.map((r) => [r.path, Number(r.requests)]),
		[
			["/Admin", 2],
			["/admin", 2],
			["/cafe", 1],
			["/café", 1],
		],
	);
	await knex.destroy();
});
