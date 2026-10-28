import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { engineOf, listTables, serverVersion } from "../lib/database/engine.js";
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
