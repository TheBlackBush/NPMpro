import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	ConnectionFileError,
	chooseDatabase,
	connectionFileOf,
	parseConnectionFile,
	publicConnection,
	writeConnectionFile,
} from "../lib/database/connection-file.js";
import { failingKnexConfig, knexConfigOf } from "../lib/database/knex-config.js";

const seal = (password) => `v1:${Buffer.from(JSON.stringify({ password })).toString("base64")}`;
const unseal = (sealed) => {
	if (!sealed.startsWith("v1:")) throw new Error("Unknown encrypted value format");
	return JSON.parse(Buffer.from(sealed.slice(3), "base64").toString()).password;
};
const dataDir = "/data/npmpro";
const UNSEALABLE = /password cannot be unsealed/u;
const COULD_NOT_USE = /Could not use \/data\/npmpro\/database\.json/u;
const postgres = {
	engine: "postgres",
	host: "db.lan",
	port: 5432,
	user: "npmpro",
	name: "npmpro",
	password: "s3cret pass ",
	ssl: { enabled: false },
};
const moved = {
	movedAt: "2026-10-29T10:00:00.000Z",
	movedFrom: { engine: "sqlite", name: "/data/npmpro/database.sqlite" },
};
const fileOf = (connection) => JSON.stringify(connectionFileOf(connection, { seal, ...moved }));
const choose = (env, files = {}) =>
	chooseDatabase({
		env,
		dataDir,
		exists: (file) => Object.hasOwn(files, file),
		read: (file) => files[file],
		unseal,
	});

it("builds a file with a sealed password and reads it back", () => {
	const content = connectionFileOf(postgres, { seal, ...moved });
	assert.equal(content.version, 1);
	assert.notEqual(content.password, postgres.password);
	assert.ok(content.password.startsWith("v1:"));
	assert.deepEqual(parseConnectionFile(JSON.stringify(content), { unseal, dataDir }), {
		...postgres,
		moved_at: moved.movedAt,
		moved_from: moved.movedFrom,
	});
});

it("keeps only the file for SQLite and the three switches for MySQL", () => {
	const sqlite = connectionFileOf(
		{ engine: "sqlite", file: "/data/npmpro/database-20261029-100000.sqlite" },
		{ seal, ...moved },
	);
	assert.deepEqual(
		Object.keys(sqlite).sort((a, b) => a.localeCompare(b)),
		["engine", "file", "moved_at", "moved_from", "version"],
	);
	const mysql = connectionFileOf(
		{
			...postgres,
			engine: "mysql",
			port: 3306,
			ssl: { enabled: true, reject_unauthorized: false, verify_identity: true },
		},
		{ seal, ...moved },
	);
	assert.deepEqual(mysql.ssl, { enabled: true, reject_unauthorized: false, verify_identity: true });
});

it("refuses unknown keys, wrong types, ranges and keys of another engine", () => {
	const good = JSON.parse(fileOf(postgres));
	const bad = [
		"not json",
		"[]",
		JSON.stringify({ ...good, version: 2 }),
		JSON.stringify({ ...good, engine: "oracle" }),
		JSON.stringify({ ...good, extra: 1 }),
		JSON.stringify({ ...good, port: 70000 }),
		JSON.stringify({ ...good, port: "5432" }),
		JSON.stringify({ ...good, host: "db lan" }),
		JSON.stringify({ ...good, name: "" }),
		JSON.stringify({ ...good, ssl: { enabled: false, verify_identity: true } }),
		JSON.stringify({ ...good, ssl: { enabled: "no" } }),
		JSON.stringify({ ...good, moved_at: "yesterday" }),
		JSON.stringify({ version: 1, engine: "sqlite", file: "/data/npmpro/database.sqlite", host: "x" }),
		JSON.stringify({ version: 1, engine: "sqlite", file: "/tmp/database.sqlite" }),
		JSON.stringify({ version: 1, engine: "sqlite", file: "/data/npmpro/../npmpro/database.sqlite" }),
	];
	for (const raw of bad) assert.throws(() => parseConnectionFile(raw, { unseal, dataDir }), ConnectionFileError, raw);
});

it("prefers complete env vars, then the file, then the default SQLite file", () => {
	const files = { "/data/npmpro/database.json": fileOf(postgres) };
	const mysqlEnv = { DB_MYSQL_HOST: "m", DB_MYSQL_USER: "u", DB_MYSQL_NAME: "n", DB_MYSQL_PASSWORD: "p" };
	const fromEnv = choose(mysqlEnv, files);
	assert.equal(fromEnv.source, "env");
	assert.deepEqual(fromEnv.connection, {
		engine: "mysql",
		host: "m",
		port: 3306,
		user: "u",
		name: "n",
		password: "p",
		ssl: { enabled: false, reject_unauthorized: true, verify_identity: true },
	});
	const pgEnv = choose({
		DB_POSTGRES_HOST: "h",
		DB_POSTGRES_USER: "u",
		DB_POSTGRES_NAME: "n",
		DB_POSTGRES_PORT: "6543",
	});
	assert.equal(pgEnv.connection.port, 6543);
	assert.deepEqual(pgEnv.connection.ssl, { enabled: false });
	// incomplete env vars do not count
	const fromFile = choose({ DB_MYSQL_HOST: "m" }, files);
	assert.equal(fromFile.source, "file");
	assert.equal(fromFile.connection.password, postgres.password);
	assert.equal(fromFile.moved_from.engine, "sqlite");
	assert.deepEqual(choose({}, {}), {
		source: "default",
		connection: { engine: "sqlite", file: "/data/npmpro/database.sqlite" },
		moved_at: null,
		moved_from: null,
	});
});

it("invalid file names the file and the way back", () => {
	const files = { "/data/npmpro/database.json": "{" };
	assert.throws(
		() => choose({}, files),
		(error) =>
			error instanceof ConnectionFileError &&
			error.message.includes("/data/npmpro/database.json") &&
			error.message.includes("Delete or rename it") &&
			error.message.includes("/data/npmpro/database.sqlite"),
	);
});

it("unsealable password stops instead of falling back", () => {
	const content = JSON.parse(fileOf(postgres));
	const files = { "/data/npmpro/database.json": JSON.stringify({ ...content, password: "v2:other-key" }) };
	assert.throws(() => choose({}, files), UNSEALABLE);
});

it("writes atomically with mode 600 and leaves no temporary file", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "dbfile-"));
	try {
		const file = path.join(dir, "database.json");
		await writeFile(file, "old");
		await writeConnectionFile(file, { version: 1 });
		assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1 });
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		assert.deepEqual(await readdir(dir), ["database.json"]);
		await assert.rejects(writeConnectionFile(path.join(dir, "missing", "database.json"), { version: 1 }));
		assert.deepEqual(await readdir(dir), ["database.json"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("an invalid file makes every query fail with its message instead of falling back", async () => {
	const { default: knexFactory } = await import("knex");
	const error = new ConnectionFileError(
		"Could not use /data/npmpro/database.json: version must be 1. Delete or rename it",
	);
	const knex = knexFactory(failingKnexConfig(error));
	try {
		await assert.rejects(knex.raw("select 1"), COULD_NOT_USE);
	} finally {
		await knex.destroy();
	}
});

it("never shows the password and builds the knex config per engine", () => {
	assert.equal(Object.hasOwn(publicConnection(postgres), "password"), false);
	const pg = knexConfigOf({ ...postgres, ssl: { enabled: true } }, { timeoutMs: 10_000 });
	assert.equal(pg.client, "pg");
	assert.equal(pg.connection.database, "npmpro");
	assert.equal(pg.connection.ssl, true);
	assert.equal(pg.connection.connectionTimeoutMillis, 10_000);
	assert.equal(pg.acquireConnectionTimeout, 10_000);
	const my = knexConfigOf({
		...postgres,
		engine: "mysql",
		ssl: { enabled: true, reject_unauthorized: false, verify_identity: true },
	});
	assert.equal(my.client, "mysql2");
	assert.deepEqual(my.connection.ssl, { rejectUnauthorized: false, verifyIdentity: true });
	assert.equal(knexConfigOf({ ...postgres, engine: "mysql", ssl: { enabled: false } }).connection.ssl, undefined);
	const lite = knexConfigOf({ engine: "sqlite", file: "/x/database.sqlite" });
	assert.equal(lite.client, "better-sqlite3");
	assert.equal(lite.connection.filename, "/x/database.sqlite");
	assert.equal(lite.useNullAsDefault, true);
	assert.equal(typeof lite.pool.afterCreate, "function");
});

const TRUTHY = /^(?:1|true|yes|on)$/iu;

// the knex config lib/config.js and db.js built before database.json existed
const oldKnexConfig = (env) => {
	const toBool = (v) => TRUTHY.test((v || "").trim());
	if (env.DB_MYSQL_HOST && env.DB_MYSQL_USER && env.DB_MYSQL_NAME) {
		const ssl = toBool(env.DB_MYSQL_SSL)
			? {
					rejectUnauthorized:
						env.DB_MYSQL_SSL_REJECT_UNAUTHORIZED === undefined
							? true
							: toBool(env.DB_MYSQL_SSL_REJECT_UNAUTHORIZED),
					verifyIdentity:
						env.DB_MYSQL_SSL_VERIFY_IDENTITY === undefined
							? true
							: toBool(env.DB_MYSQL_SSL_VERIFY_IDENTITY),
				}
			: false;
		return {
			client: "mysql2",
			connection: {
				host: env.DB_MYSQL_HOST,
				user: env.DB_MYSQL_USER,
				password: env.DB_MYSQL_PASSWORD,
				database: env.DB_MYSQL_NAME,
				port: env.DB_MYSQL_PORT || 3306,
				...(ssl ? { ssl } : {}),
			},
			migrations: { tableName: "migrations" },
		};
	}
	return {
		client: "pg",
		connection: {
			host: env.DB_POSTGRES_HOST,
			user: env.DB_POSTGRES_USER,
			password: env.DB_POSTGRES_PASSWORD,
			database: env.DB_POSTGRES_NAME,
			port: env.DB_POSTGRES_PORT || 5432,
		},
		migrations: { tableName: "migrations" },
	};
};

it("complete env vars give the same knex config as before (the port as a number)", () => {
	const envs = [
		{ DB_MYSQL_HOST: "m", DB_MYSQL_USER: "u", DB_MYSQL_NAME: "n", DB_MYSQL_PASSWORD: "p" },
		{ DB_MYSQL_HOST: "m", DB_MYSQL_USER: "u", DB_MYSQL_NAME: "n", DB_MYSQL_PORT: "3307" },
		{ DB_MYSQL_HOST: "m", DB_MYSQL_USER: "u", DB_MYSQL_NAME: "n", DB_MYSQL_SSL: "true" },
		{
			DB_MYSQL_HOST: "m",
			DB_MYSQL_USER: "u",
			DB_MYSQL_NAME: "n",
			DB_MYSQL_SSL: "on",
			DB_MYSQL_SSL_REJECT_UNAUTHORIZED: "false",
			DB_MYSQL_SSL_VERIFY_IDENTITY: "no",
		},
		{ DB_POSTGRES_HOST: "h", DB_POSTGRES_USER: "u", DB_POSTGRES_NAME: "n", DB_POSTGRES_PASSWORD: "p" },
		{ DB_POSTGRES_HOST: "h", DB_POSTGRES_USER: "u", DB_POSTGRES_NAME: "n", DB_POSTGRES_PORT: "6543" },
	];
	for (const env of envs) {
		const old = oldKnexConfig(env);
		old.connection.port = Number(old.connection.port);
		const config = knexConfigOf(choose(env).connection);
		if (config.client === "mysql2") {
			// added since: dates in the session's zone (database-mysql-zone.test.js)
			assert.equal(config.connection.timezone, "local");
			assert.equal(typeof config.pool.afterCreate, "function");
			delete config.connection.timezone;
			delete config.pool;
		}
		assert.deepEqual(config, old, JSON.stringify(env));
	}
});

it("no file and no env vars give the same SQLite file and pragmas as before", () => {
	const lite = knexConfigOf(choose({}).connection);
	assert.deepEqual(lite.connection, { filename: "/data/npmpro/database.sqlite" });
	const pragmas = [];
	let result;
	lite.pool.afterCreate({ pragma: (p) => pragmas.push(p) }, (error, conn) => {
		result = { error, conn };
	});
	assert.deepEqual(pragmas, [
		"synchronous = NORMAL",
		"secure_delete = FAST",
		"temp_store = MEMORY",
		"optimize = 0x10002",
	]);
	assert.equal(result.error, null);
});

it("a file without a known origin leaves out moved_at and moved_from and reads back", () => {
	for (const origin of [
		{ movedAt: null, movedFrom: null },
		{ movedAt: undefined, movedFrom: undefined },
	]) {
		const content = connectionFileOf(postgres, { seal, ...origin });
		assert.equal(Object.hasOwn(content, "moved_at"), false);
		assert.equal(Object.hasOwn(content, "moved_from"), false);
		assert.deepEqual(parseConnectionFile(JSON.stringify(content), { unseal, dataDir }), {
			...postgres,
			moved_at: null,
			moved_from: null,
		});
	}
});

it("a JSON error never quotes the file content", () => {
	const raw = '{"version": 1, "password": "hand typed secret" oops}';
	assert.throws(
		() => parseConnectionFile(raw, { unseal, dataDir }),
		(error) =>
			error instanceof ConnectionFileError &&
			error.message.startsWith("it is not valid JSON") &&
			!error.message.includes("secret") &&
			!error.message.includes("oops"),
	);
	assert.throws(
		() => choose({}, { "/data/npmpro/database.json": raw }),
		(error) => !error.message.includes("secret") && error.message.includes("is not valid JSON"),
	);
});

it("incomplete env vars without a file use the default SQLite file", () => {
	const chosen = choose({ DB_POSTGRES_HOST: "h", DB_POSTGRES_USER: "u" }, {});
	assert.equal(chosen.source, "default");
	assert.deepEqual(chosen.connection, { engine: "sqlite", file: "/data/npmpro/database.sqlite" });
});

it("complete MySQL and Postgres env vars together use MySQL", () => {
	const chosen = choose({
		DB_MYSQL_HOST: "m",
		DB_MYSQL_USER: "u",
		DB_MYSQL_NAME: "n",
		DB_POSTGRES_HOST: "h",
		DB_POSTGRES_USER: "u",
		DB_POSTGRES_NAME: "n",
	});
	assert.equal(chosen.source, "env");
	assert.equal(chosen.connection.engine, "mysql");
	assert.equal(chosen.connection.host, "m");
});

it("accepts a dated SQLite file from a move", () => {
	const file = "/data/npmpro/database-20261029-100000.sqlite";
	const raw = JSON.stringify(connectionFileOf({ engine: "sqlite", file }, { seal, ...moved }));
	assert.deepEqual(parseConnectionFile(raw, { unseal, dataDir }), {
		engine: "sqlite",
		file,
		moved_at: moved.movedAt,
		moved_from: moved.movedFrom,
	});
	const chosen = choose({}, { "/data/npmpro/database.json": raw });
	assert.equal(chosen.source, "file");
	assert.equal(chosen.connection.file, file);
});
