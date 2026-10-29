import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { pathHash } from "../lib/traffic/path-hash.js";
import { createStore } from "../lib/traffic/store.js";
import { up as upMonitoring } from "../migrations/20261024120000_monitoring.js";
import { up as upVisitors } from "../migrations/20261024200000_monitoring_visitors.js";
import { up } from "../migrations/20261029120000_traffic_paths.js";
import { mariaKnex, mariaSkip, pgSkip, resetPg } from "./support/database.js";

const env = process.env;
// rollUpAndPrune touches every traffic table
const TRAFFIC_TABLES = [
	"traffic_minute",
	"traffic_hour",
	"traffic_country_hour",
	"traffic_asn_hour",
	"traffic_ip_hour",
	"traffic_visitor",
	"traffic_path_hour",
];
const PATHS = ["/Admin", "/admin", "/café", "/cafe", "/😀", `/${"é".repeat(199)}`];
const NOW = Date.UTC(2026, 9, 29, 12, 30, 0);
const TODAY = Math.floor(NOW / 86400000);

const roundTrip = async (knex) => {
	await upMonitoring(knex);
	await upVisitors(knex);
	await up(knex);
	// a rerun is safe
	await up(knex);
	const store = createStore(knex);
	const rows = (requests, lastSeen, bucket = TODAY * 24 + 3) =>
		PATHS.map((path) => ({ bucket, host: "a.example", path, requests, last_seen: lastSeen }));
	// a time after 2038, which a 32-bit column cannot hold
	await store.flush({ minutes: [], paths: rows(1, 20_000_000_000) });
	await store.flush({ minutes: [], paths: rows(2, 5) });
	const stored = await knex("traffic_path_hour").select("path", "requests", "last_seen");
	assert.deepEqual(stored.map((r) => r.path).sort(), [...PATHS].sort());
	for (const r of stored) {
		assert.equal(Number(r.requests), 3);
		assert.equal(Number(r.last_seen), 20_000_000_000);
	}
	await assert.rejects(
		knex("traffic_path_hour").insert({
			bucket: TODAY * 24 + 3,
			host: "a.example",
			path: "/Admin",
			requests: 1,
			last_seen: 1,
		}),
	);
	// the daily roll-up merges into an existing day row
	const old = (TODAY - 4) * 24;
	await store.flush({ minutes: [], paths: [...rows(1, 7, old), ...rows(1, 9, old + 7)] });
	await store.rollUpAndPrune({ now: NOW, retentionDays: 30 });
	const day = await knex("traffic_path_hour").where("bucket", "<", (TODAY - 2) * 24);
	assert.equal(day.length, PATHS.length);
	for (const r of day) {
		assert.equal(Number(r.bucket), old);
		assert.equal(Number(r.requests), 2);
		assert.equal(Number(r.last_seen), 9);
	}
	// the top paths read sums the day rows and today's hour rows (the order of equal counts depends on the collation)
	const { top_404_paths: top } = await store.queryTraffic({ range: "30d", paths: true, now: NOW });
	assert.deepEqual(
		top.map((r) => [r.path, r.requests, r.last_seen]).sort(),
		PATHS.map((path) => [path, 5, new Date(20_000_000_000_000).toISOString()]).sort(),
	);
	const [seed] = await store.pathDayHashes({ days: [TODAY - 1, TODAY] });
	assert.deepEqual([...seed.hashes].sort(), PATHS.map(pathHash).sort());
	await store.deletePaths();
	assert.equal((await knex("traffic_path_hour")).length, 0);
};

it("creates traffic_path_hour on SQLite", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	try {
		await roundTrip(knex);
	} finally {
		await knex.destroy();
	}
});

it("creates traffic_path_hour on Postgres", { skip: pgSkip, timeout: 60_000 }, async () => {
	const knex = knexFactory({
		client: "pg",
		connection: {
			host: env.POSTGRES_NPMPRO_HOST,
			port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
			user: env.POSTGRES_NPMPRO_USER,
			password: env.POSTGRES_NPMPRO_PASS,
			database: "npmpro_test_unit",
		},
	});
	try {
		await resetPg(knex);
		await roundTrip(knex);
	} finally {
		await knex.destroy();
	}
});

it("creates traffic_path_hour on MariaDB with a latin1 server default", {
	skip: mariaSkip,
	timeout: 60_000,
}, async () => {
	const knex = mariaKnex();
	try {
		for (const table of TRAFFIC_TABLES) await knex.schema.dropTableIfExists(table);
		await roundTrip(knex);
		const [[table]] = await knex.raw(
			"select table_collation as collation_name from information_schema.tables where table_schema = database() and table_name = 'traffic_path_hour'",
		);
		assert.equal(table.collation_name, "utf8mb4_bin");
	} finally {
		await knex.destroy();
	}
});
