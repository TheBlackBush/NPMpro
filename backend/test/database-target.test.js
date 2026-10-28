import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { databaseSize, engineOf, listTables, serverVersion } from "../lib/database/engine.js";
import { knexConfigOf } from "../lib/database/knex-config.js";
import { parseVersion, sameDatabase, testTarget, validateTarget, versionProblem } from "../lib/database/target.js";
import errs from "../lib/error.js";
import { pgConnection, pgSkip, resetPg, tempSqlite } from "./support/database.js";

const isMoveError = (code) => (error) => error instanceof errs.DatabaseMoveError && error.code === code;
const current = { engine: "sqlite", file: "/data/npmpro/database.sqlite" };

it("reads versions and applies the floors", () => {
	assert.deepEqual(parseVersion("mysql", "10.11.6-MariaDB-1:10.11.6+maria~ubu2204"), {
		flavor: "mariadb",
		major: 10,
		minor: 11,
		text: "10.11.6-MariaDB-1:10.11.6+maria~ubu2204",
	});
	assert.equal(parseVersion("mysql", "8.0.36").flavor, "mysql");
	assert.equal(parseVersion("postgres", "17.11 (Debian 17.11-1.pgdg13+2)").major, 17);
	assert.equal(parseVersion("postgres", "garbage"), null);
	assert.equal(versionProblem(parseVersion("mysql", "8.0.0")), null);
	assert.equal(versionProblem(parseVersion("mysql", "10.6.0-MariaDB")), null);
	assert.equal(versionProblem(parseVersion("postgres", "13.0")), null);
	assert.match(
		versionProblem(parseVersion("mysql", "5.7.44")),
		/MySQL 5\.7 is too old, NPMpro needs MySQL 8\.0 or newer/u,
	);
	assert.match(versionProblem(parseVersion("mysql", "10.5.9-MariaDB")), /MariaDB 10\.5 is too old/u);
	assert.match(versionProblem(parseVersion("postgres", "12.18")), /PostgreSQL 12\.18 is too old/u);
	assert.match(versionProblem(null), /version could not be read/u);
});

it("validates the target and fills the defaults", () => {
	assert.deepEqual(validateTarget({ engine: "sqlite", host: "ignored" }), { engine: "sqlite" });
	assert.deepEqual(validateTarget({ engine: "postgres", host: "db", port: 5432, user: "u", name: "n" }), {
		engine: "postgres",
		host: "db",
		port: 5432,
		user: "u",
		name: "n",
		password: "",
		ssl: { enabled: false },
	});
	assert.deepEqual(
		validateTarget({
			engine: "mysql",
			host: "db",
			port: 3306,
			user: "u",
			name: "n",
			password: " p ",
			ssl: { enabled: true },
		}).ssl,
		{ enabled: true, reject_unauthorized: true, verify_identity: true },
	);
	assert.throws(() => validateTarget({ engine: "oracle" }), isMoveError("invalid-target"));
	assert.throws(
		() => validateTarget({ engine: "mysql", host: "db", port: 0, user: "u", name: "n" }),
		isMoveError("invalid-target"),
	);
});

it("refuses the database in use", () => {
	const pg = { engine: "postgres", host: "DB.lan", port: 5432, name: "npmpro" };
	assert.equal(sameDatabase(pg, { ...pg, host: "db.LAN" }), true);
	assert.equal(sameDatabase(pg, { ...pg, name: "other" }), false);
	assert.equal(sameDatabase(pg, { ...pg, port: 5433 }), false);
	assert.equal(sameDatabase(pg, { ...pg, engine: "mysql" }), false);
	assert.equal(sameDatabase(current, { engine: "sqlite" }), false);
});

it("has nothing to test for SQLite", async () => {
	assert.deepEqual(await testTarget({ target: { engine: "sqlite" }, current, createKnex: () => assert.fail() }), {
		engine: "sqlite",
		version: null,
		flavor: null,
	});
});

it("stops after the timeout and reports a refused connection", async () => {
	const fake = (raw) => () => ({ client: { config: { client: "pg" } }, raw, destroy: async () => {} });
	const target = validateTarget({ engine: "postgres", host: "db", port: 5432, user: "u", name: "n" });
	await assert.rejects(
		testTarget({ target, current, createKnex: fake(() => new Promise(() => {})), timeoutMs: 50 }),
		isMoveError("timeout"),
	);
	await assert.rejects(
		testTarget({
			target,
			current,
			createKnex: fake(() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1:5432"))),
		}),
		(error) => isMoveError("connect")(error) && error.details.includes("ECONNREFUSED"),
	);
	await assert.rejects(
		testTarget({ target, current: { ...target }, createKnex: () => assert.fail() }),
		isMoveError("same-database"),
	);
});

it("lists tables and reads the version on SQLite", async () => {
	const db = await tempSqlite();
	const knex = knexFactory(knexConfigOf(db.connection));
	try {
		assert.equal(engineOf(knex), "sqlite");
		assert.deepEqual(await listTables(knex), []);
		await knex.schema.createTable("b_table", (t) => t.increments());
		await knex.schema.createTable("a_table", (t) => t.increments());
		assert.deepEqual(await listTables(knex), ["a_table", "b_table"]);
		assert.match(await serverVersion(knex), /^3\.\d+/u);
	} finally {
		await knex.destroy();
		await db.cleanup();
	}
});

it("tests a Postgres target: empty passes, a table refuses, a wrong password fails", {
	skip: pgSkip,
	timeout: 60_000,
}, async () => {
	const knex = knexFactory(knexConfigOf(pgConnection));
	try {
		await resetPg(knex);
		const target = validateTarget(pgConnection);
		const ok = await testTarget({ target, current, createKnex: knexFactory });
		assert.equal(ok.engine, "postgres");
		assert.equal(ok.flavor, "postgres");
		assert.deepEqual(await listTables(knex), []);
		await knex.schema.createTable("leftover", (t) => t.increments());
		await assert.rejects(
			testTarget({ target, current, createKnex: knexFactory }),
			(error) => isMoveError("not-empty")(error) && error.details.includes("leftover"),
		);
		await assert.rejects(
			testTarget({ target: { ...target, password: "wrong-password" }, current, createKnex: knexFactory }),
			(error) => isMoveError("connect")(error) && !error.details.includes("wrong-password"),
		);
	} finally {
		await resetPg(knex);
		await knex.destroy();
	}
});

it("never shows the password in the driver message, and always destroys the connection", async () => {
	let destroyed = 0;
	const createKnex = () => ({
		client: { config: { client: "pg" } },
		raw: () => Promise.reject(new Error("bad uri postgres://u:s3cret-pw@db:5432/n")),
		destroy: async () => {
			destroyed += 1;
		},
	});
	const target = validateTarget({
		engine: "postgres",
		host: "db",
		port: 5432,
		user: "u",
		name: "n",
		password: "s3cret-pw",
	});
	await assert.rejects(
		testTarget({ target, current, createKnex }),
		(error) =>
			isMoveError("connect")(error) && !error.details.includes("s3cret-pw") && error.details.includes("***"),
	);
	assert.equal(destroyed, 1);
});

const server = { engine: "postgres", host: "db", port: 5432, user: "u", name: "n" };
const fakeKnex = ({ client = "pg", raw, schema, destroy } = {}) => ({
	client: { config: { client } },
	raw: raw ?? (async () => ({ rows: [{ server_version: "17.1" }] })),
	schema: schema ?? {
		createTable: async () => {},
		dropTable: async () => {},
		dropTableIfExists: async () => {},
	},
	destroy: destroy ?? (async () => {}),
});

it("stops when a step after connecting hangs and still destroys the connection", async () => {
	let destroyed = 0;
	const target = validateTarget(server);
	const raw = (sql) =>
		/server_version/u.test(sql) ? Promise.resolve({ rows: [{ server_version: "17.1" }] }) : new Promise(() => {});
	await assert.rejects(
		testTarget({
			target,
			current,
			createKnex: () =>
				fakeKnex({
					raw,
					destroy: async () => {
						destroyed += 1;
					},
				}),
			timeoutMs: 50,
		}),
		isMoveError("timeout"),
	);
	assert.equal(destroyed, 1);
});

it("returns even when destroy never finishes", async () => {
	const target = validateTarget(server);
	const raw = (sql) =>
		Promise.resolve(/server_version/u.test(sql) ? { rows: [{ server_version: "17.1" }] } : { rows: [] });
	const result = await testTarget({
		target,
		current,
		createKnex: () => fakeKnex({ raw, destroy: () => new Promise(() => {}) }),
		timeoutMs: 100,
	});
	assert.equal(result.flavor, "postgres");
});

it("scrubs the password in every encoding", async () => {
	const password = 'p@ss/w:rd"';
	const target = validateTarget({ ...server, password });
	const echo = `${password} ${encodeURIComponent(password)} ${encodeURI(password)} ${JSON.stringify(password)}`;
	await assert.rejects(
		testTarget({ target, current, createKnex: () => fakeKnex({ raw: () => Promise.reject(new Error(echo)) }) }),
		(error) =>
			isMoveError("connect")(error) &&
			!error.details.includes("p@ss") &&
			!error.details.includes("p%40ss") &&
			!error.details.includes("w:rd"),
	);
});

it("reports a create failure and a drop failure with its retry", async () => {
	const target = validateTarget(server);
	const raw = (sql) =>
		Promise.resolve(/server_version/u.test(sql) ? { rows: [{ server_version: "17.1" }] } : { rows: [] });
	await assert.rejects(
		testTarget({
			target,
			current,
			createKnex: () => fakeKnex({ raw, schema: { createTable: () => Promise.reject(new Error("denied")) } }),
		}),
		(error) => isMoveError("permission")(error) && error.details === "denied",
	);
	let drops = 0;
	await assert.rejects(
		testTarget({
			target,
			current,
			createKnex: () =>
				fakeKnex({
					raw,
					schema: {
						createTable: async () => {},
						dropTable: () => {
							drops += 1;
							return Promise.reject(new Error("no drop"));
						},
					},
				}),
		}),
		(error) => isMoveError("permission")(error) && error.details.includes("npmpro_move_probe was left"),
	);
	assert.equal(drops, 2);
});

it("refuses an old server and unknown or mistyped target settings", async () => {
	const target = validateTarget({ ...server, engine: "mysql", port: 3306 });
	const raw = async () => [[{ version: "5.7.44" }]];
	await assert.rejects(
		testTarget({ target, current, createKnex: () => fakeKnex({ client: "mysql2", raw }) }),
		(error) => isMoveError("version")(error) && error.details === "5.7.44",
	);
	assert.throws(() => validateTarget({ ...server, extra: 1 }), isMoveError("invalid-target"));
	assert.throws(() => validateTarget({ ...server, ssl: { enabled: "yes" } }), isMoveError("invalid-target"));
	assert.throws(() => validateTarget({ ...server, ssl: { verify_identity: true } }), isMoveError("invalid-target"));
	assert.throws(() => validateTarget({ ...server, ssl: [] }), isMoveError("invalid-target"));
});

it("reads other version strings", () => {
	assert.equal(parseVersion("postgres", "PostgreSQL 13.14 on x86_64-pc-linux-gnu").major, 13);
	assert.deepEqual(parseVersion("postgres", "17beta1"), { flavor: "postgres", major: 17, minor: 0, text: "17beta1" });
	const proxied = parseVersion("mysql", "5.5.5-10.6.12-MariaDB");
	assert.equal(proxied.flavor, "mariadb");
	assert.equal(proxied.major, 10);
	assert.equal(
		sameDatabase(
			{ engine: "mysql", host: "h", port: 3306, name: "Npm" },
			{ engine: "mysql", host: "h", port: 3306, name: "npm" },
		),
		true,
	);
	assert.equal(
		sameDatabase(
			{ engine: "postgres", host: "h", port: 3306, name: "Npm" },
			{ engine: "postgres", host: "h", port: 3306, name: "npm" },
		),
		false,
	);
});

it("uses the MySQL and Postgres queries", async () => {
	const queries = [];
	const mysql = fakeKnex({
		client: "mysql2",
		raw: async (sql) => {
			queries.push(sql);
			if (sql.includes("version()")) return [[{ version: "10.11.6-MariaDB" }], []];
			if (sql.includes("sum(")) return [[{ size: "2048" }], []];
			return [[{ name: "b" }, { name: "a" }], []];
		},
	});
	assert.equal(engineOf(mysql), "mysql");
	assert.deepEqual(await listTables(mysql), ["a", "b"]);
	assert.match(queries[0], /table_type = 'BASE TABLE'/u);
	assert.doesNotMatch((await listTables(mysql, { views: true }), queries[1]), /BASE TABLE/u);
	assert.equal(await serverVersion(mysql), "10.11.6-MariaDB");
	assert.equal(await databaseSize(mysql), 2048);
	const pg = fakeKnex({
		raw: async (sql) => {
			queries.push(sql);
			if (sql.includes("pg_database_size")) return { rows: [{ size: "4096" }] };
			return { rows: [{ name: "t" }] };
		},
	});
	assert.deepEqual(await listTables(pg), ["t"]);
	assert.match(queries.at(-1), /pg_class/u);
	assert.match(queries.at(-1), /relkind in \('r', 'p', 'f'\)/u);
	await listTables(pg, { views: true });
	assert.match(queries.at(-1), /'v', 'm'/u);
	assert.equal(await databaseSize(pg), 4096);
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const emptyRaw = (late) => (sql) =>
	/server_version/u.test(sql) ? Promise.resolve({ rows: [{ server_version: "17.1" }] }) : late(sql);

it("a listTables that finishes after the timeout does not start the probe", async () => {
	const calls = [];
	const target = validateTarget(server);
	const knex = fakeKnex({
		raw: emptyRaw(async () => {
			await pause(150);
			return { rows: [] };
		}),
		schema: {
			createTable: async () => calls.push("create"),
			dropTable: async () => calls.push("drop"),
			dropTableIfExists: async () => calls.push("dropIfExists"),
		},
	});
	await assert.rejects(
		testTarget({ target, current, createKnex: () => knex, timeoutMs: 50 }),
		isMoveError("timeout"),
	);
	await pause(200);
	assert.deepEqual(calls, []);
});

it("drops the probe only after a create that was running at the timeout has settled", async () => {
	const calls = [];
	const target = validateTarget(server);
	const knex = fakeKnex({
		raw: emptyRaw(async () => ({ rows: [] })),
		schema: {
			createTable: async () => {
				calls.push("create start");
				await pause(80);
				calls.push("create end");
			},
			dropTable: async () => calls.push("drop"),
			dropTableIfExists: async () => calls.push("dropIfExists"),
		},
	});
	await assert.rejects(
		testTarget({ target, current, createKnex: () => knex, timeoutMs: 50 }),
		isMoveError("timeout"),
	);
	assert.deepEqual(calls, ["create start", "create end", "dropIfExists"]);
});

it("does not let a late step run when destroy hangs, and says the probe may be left", async () => {
	const calls = [];
	const target = validateTarget(server);
	const knex = fakeKnex({
		raw: emptyRaw(async () => ({ rows: [] })),
		schema: {
			createTable: () => new Promise(() => {}),
			dropTable: async () => calls.push("drop"),
			dropTableIfExists: async () => calls.push("dropIfExists"),
		},
		destroy: () => new Promise(() => {}),
	});
	await assert.rejects(
		testTarget({ target, current, createKnex: () => knex, timeoutMs: 50 }),
		(error) => isMoveError("timeout")(error) && error.details.includes("npmpro_move_probe may be left"),
	);
	assert.deepEqual(calls, []);
});
