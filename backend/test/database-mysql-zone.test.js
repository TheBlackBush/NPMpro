import assert from "node:assert/strict";
import { it } from "node:test";
import { knexConfigOf, mysqlSessionZone, resetZoneNote, utcOffsetOf } from "../lib/database/knex-config.js";

// a mysql2 callback connection that answers each SET time_zone with the given errors in order
const fakeConnection = (errors = []) => {
	const queries = [];
	return {
		queries,
		query(sql, params, callback) {
			queries.push([sql, ...params]);
			callback(errors.shift() ?? null);
		},
	};
};
const unknownZone = Object.assign(new Error("Unknown or incorrect time zone: 'Asia/Jerusalem'"), { errno: 1298 });
const run = (afterCreate, conn) =>
	new Promise((resolve) => {
		afterCreate(conn, (error, connection) => resolve({ error, connection }));
	});

it("sets the session to the container's zone name when the server knows it", async () => {
	resetZoneNote();
	const notes = [];
	const conn = fakeConnection();
	const result = await run(mysqlSessionZone({ zone: "Asia/Jerusalem", note: (line) => notes.push(line) }), conn);
	assert.equal(result.error, null);
	assert.equal(result.connection, conn);
	assert.deepEqual(conn.queries, [["SET time_zone = ?", "Asia/Jerusalem"]]);
	assert.deepEqual(notes, []);
});

it("falls back to the current UTC offset without zone tables and notes it once", async () => {
	resetZoneNote();
	const notes = [];
	const afterCreate = mysqlSessionZone({
		zone: "Asia/Jerusalem",
		now: () => ({ getTimezoneOffset: () => -120 }),
		note: (line) => notes.push(line),
	});
	const first = fakeConnection([unknownZone]);
	const second = fakeConnection([unknownZone]);
	assert.equal((await run(afterCreate, first)).error, null);
	assert.equal((await run(afterCreate, second)).error, null);
	assert.deepEqual(first.queries, [
		["SET time_zone = ?", "Asia/Jerusalem"],
		["SET time_zone = ?", "+02:00"],
	]);
	assert.deepEqual(second.queries.at(-1), ["SET time_zone = ?", "+02:00"]);
	assert.equal(notes.length, 1);
	assert.match(notes[0], /no time zone tables.*Asia\/Jerusalem.*\+02:00.*restart/u);
});

it("passes any other error on and fails the connection", async () => {
	resetZoneNote();
	const denied = Object.assign(new Error("denied"), { errno: 1045 });
	const conn = fakeConnection([denied]);
	const result = await run(mysqlSessionZone({ zone: "Europe/Berlin" }), conn);
	assert.equal(result.error, denied);
	assert.equal(conn.queries.length, 1);
	// an offset the server refuses fails the connection too
	const refused = new Error("refused");
	const again = fakeConnection([unknownZone, refused]);
	assert.equal((await run(mysqlSessionZone({ zone: "X/Y", now: () => new Date() }), again)).error, refused);
});

it("writes UTC offsets as MySQL takes them", () => {
	const at = (minutes) => ({ getTimezoneOffset: () => minutes });
	assert.equal(utcOffsetOf(at(-120)), "+02:00");
	assert.equal(utcOffsetOf(at(0)), "+00:00");
	assert.equal(utcOffsetOf(at(210)), "-03:30");
	assert.equal(utcOffsetOf(at(-345)), "+05:45");
});

it("every MySQL config reads local dates and sets the session zone; Postgres and SQLite are unchanged", () => {
	const server = { host: "db", port: 3306, user: "u", name: "n", password: "p", ssl: { enabled: false } };
	for (const options of [{}, { timeoutMs: 10_000 }]) {
		const my = knexConfigOf({ ...server, engine: "mysql" }, options);
		assert.equal(my.connection.timezone, "local");
		assert.equal(typeof my.pool.afterCreate, "function");
		if (options.timeoutMs)
			assert.deepEqual(
				{ ...my.pool, afterCreate: undefined },
				{ min: 0, max: 1, destroyTimeoutMillis: 10_000, afterCreate: undefined },
			);
	}
	const pg = knexConfigOf({ ...server, engine: "postgres", port: 5432 });
	assert.equal(pg.connection.timezone, undefined);
	assert.equal(pg.pool, undefined);
	const lite = knexConfigOf({ engine: "sqlite", file: "/x.sqlite" });
	assert.equal(lite.connection.timezone, undefined);
	// knex's log only when given
	assert.equal(knexConfigOf({ ...server, engine: "mysql" }).log, undefined);
	const log = { warn() {} };
	assert.equal(knexConfigOf({ ...server, engine: "mysql" }, { log }).log, log);
	assert.equal(knexConfigOf({ engine: "sqlite", file: "/x.sqlite" }, { log }).log, log);
});
