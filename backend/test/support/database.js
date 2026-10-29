import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import knexFactory from "knex";
import { knexConfigOf } from "../../lib/database/knex-config.js";
import { runMigrations } from "../../lib/database/schema.js";

const env = process.env;

// the Postgres tests run only where the test server is configured (not in CI)
const pgSkip = env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set";

// the MariaDB tests run only against a throwaway server (MARIADB_NPMPRO_TEST_*), never in CI
const mariaSkip = env.MARIADB_NPMPRO_TEST_HOST ? false : "MARIADB_NPMPRO_TEST_HOST is not set";

const mariaKnex = () =>
	knexFactory({
		client: "mysql2",
		connection: {
			host: env.MARIADB_NPMPRO_TEST_HOST,
			port: Number(env.MARIADB_NPMPRO_TEST_PORT ?? 3306),
			user: env.MARIADB_NPMPRO_TEST_USER,
			password: env.MARIADB_NPMPRO_TEST_PASS,
			database: env.MARIADB_NPMPRO_TEST_NAME ?? "npmpro_test_unit",
		},
	});

const pgConnection = {
	engine: "postgres",
	host: env.POSTGRES_NPMPRO_HOST ?? "",
	port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
	user: env.POSTGRES_NPMPRO_USER ?? "",
	name: "npmpro_test_unit",
	password: env.POSTGRES_NPMPRO_PASS ?? "",
	ssl: { enabled: false },
};

// only ever npmpro_test_unit
const resetPg = async (knex) => {
	await knex.raw("drop schema public cascade");
	await knex.raw("create schema public");
};

const tempSqlite = async (name = "database.sqlite") => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "npmpro-db-"));
	const file = path.join(dir, name);
	return {
		dir,
		file,
		connection: { engine: "sqlite", file },
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
};

// a temp SQLite file with every NPMpro migration applied
const migratedSqlite = async (name) => {
	const db = await tempSqlite(name);
	const knex = knexFactory(knexConfigOf(db.connection));
	await runMigrations(knex);
	return {
		...db,
		knex,
		cleanup: async () => {
			await knex.destroy();
			await db.cleanup();
		},
	};
};

const KIND_VALUES = [
	[/json/iu, () => "{}"],
	[/bool/iu, () => 1],
	[/date|time/iu, () => "2026-10-29 10:00:00"],
	[/int|numeric|decimal|real|double|float/iu, () => 1],
];

// a row that satisfies every NOT NULL column without a default; overrides win
const fillRow = (columnInfo, overrides = {}) => {
	const row = {};
	for (const [name, column] of Object.entries(columnInfo)) {
		if (name === "id" || column.nullable || column.defaultValue !== null) continue;
		const match = KIND_VALUES.find(([pattern]) => pattern.test(String(column.type)));
		row[name] = match ? match[1]() : `${name}-value`;
	}
	return { ...row, ...overrides };
};

// rows in every value class the move must keep, on a migrated SQLite database (naive local dates, JSON text)
const seedSource = async (knex) => {
	const insert = async (table, rows) => {
		const info = await knex(table).columnInfo();
		for (const row of rows) await knex(table).insert(fillRow(info, row));
	};
	await insert(
		"user",
		Array.from({ length: 7 }, (_, index) => ({
			email: `user${index}@example.com`,
			name: `User ${index}`,
			roles: JSON.stringify(index === 0 ? ["admin"] : []),
			avatar: "",
			created_on: "2026-10-29 10:00:00",
			modified_on: "2026-10-29 10:00:00",
		})),
	);
	await insert(
		"proxy_host",
		Array.from({ length: 13 }, (_, index) => ({
			domain_names: JSON.stringify([`h${index}.example.com`]),
			meta: JSON.stringify({ nested: { list: [1, "two", null] }, empty: "" }),
			forward_host: index === 3 ? "" : `10.0.0.${index}`,
			advanced_config: index === 4 ? "location / {\n\treturn 200 'é ☃';\n}" : "",
		})),
	);
	await knex("proxy_host").whereIn("id", [2, 5]).delete();
	await insert("setting", [
		{ id: "Zeta", name: "Z", description: "", value: "z", meta: "{}" },
		{ id: "alpha", name: "a", description: "", value: "a", meta: '{"b":1,"a":2}' },
		{ id: "default-site", name: "d", description: "", value: "congratulations", meta: "{}" },
	]);
	await insert("npmpro_proxy_host_access_list", [
		{ proxy_host_id: 1, location_id: 0, access_list_id: 2, position: 0 },
		{ proxy_host_id: 1, location_id: 0, access_list_id: 1, position: 1 },
	]);
	await insert("traffic_hour", [
		{ bucket: 1, host: "h1.example.com", status_class: "2xx", requests: 3, bytes: 5_000_000_000 },
	]);
	await insert("npmpro_backup_schedule", [
		{
			created_on: "2026-10-29 10:00:00",
			modified_on: "2026-10-29 10:00:00",
			owner_user_id: 1,
			name: "Nightly",
			enabled: 0,
			frequency: "daily",
			time: "03:00",
			types: '["proxy_hosts"]',
			protection: "none",
			keep: 3,
			next_run_at: null,
			last_error: "",
		},
	]);
	await insert("session_revocation", [{ sid: "sid-1", expires_at: 1_800_000_000 }]);
	await insert("audit_log", [{ user_id: 1, action: "created", object_type: "user", meta: '{"name":"User 0"}' }]);
	const counts = {};
	for (const table of ["user", "proxy_host", "setting", "npmpro_proxy_host_access_list", "traffic_hour"]) {
		const [{ count }] = await knex(table).count({ count: "*" });
		counts[table] = Number(count);
	}
	return { counts };
};

export { fillRow, mariaKnex, mariaSkip, migratedSqlite, pgConnection, pgSkip, resetPg, seedSource, tempSqlite };
