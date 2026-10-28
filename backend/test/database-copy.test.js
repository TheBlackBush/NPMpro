import assert from "node:assert/strict";
import { it } from "node:test";

process.env.TZ = "America/New_York";
const { default: knexFactory } = await import("knex");
const { copyTable, countRows, resetSequences, verifyTable } = await import("../lib/database/copy.js");
const { knexConfigOf } = await import("../lib/database/knex-config.js");
const { compareSchemas, foreignKeys, keyColumns, runMigrations, tableOrder } = await import(
	"../lib/database/schema.js"
);
const { columnKinds } = await import("../lib/database/values.js");
const { default: errs } = await import("../lib/error.js");
const { fillRow, migratedSqlite, pgConnection, pgSkip, resetPg, seedSource } = await import("./support/database.js");

const isMoveError = (code) => (error) => error instanceof errs.DatabaseMoveError && error.code === code;

const BIG = "9007199254740993";
const JSON_TEXT = new Set(["meta", "domain_names", "roles", "types"]);

// the copy as the move runs it, table by table
const copyAll = async (source, target, { batchSize } = {}) => {
	const { tables, info } = await compareSchemas(source, target);
	const order = tableOrder(tables, await foreignKeys(source));
	const progress = [];
	for (const table of order) {
		const key = await keyColumns(source, table);
		const kinds = columnKinds(info[table].source, info[table].target, table);
		await copyTable({
			source,
			target,
			table,
			key,
			kinds,
			batchSize,
			onRows: (copied) => progress.push([table, copied]),
		});
	}
	await resetSequences(source, target, order);
	for (const table of order) {
		const key = await keyColumns(source, table);
		await verifyTable({
			source,
			target,
			table,
			key,
			kinds: columnKinds(info[table].source, info[table].target, table),
		});
	}
	return { order, progress };
};

const kindsOf = async (source, target, table) => {
	const { info } = await compareSchemas(source, target);
	return columnKinds(info[table].source, info[table].target, table);
};

// a traffic row whose bytes do not fit a double (2^53 + 1), read back as exact text
const addBigRow = (knex) =>
	knex.raw(
		`insert into traffic_hour (bucket, host, status_class, requests, bytes) values (2, 'big.example.com', '2xx', 1, ${BIG})`,
	);
const bigBytes = async (knex) =>
	String(
		(await knex("traffic_hour").where("host", "big.example.com").select("bytes").options({ safeIntegers: true }))[0]
			.bytes,
	);

it("copies every table in pages and verifies it (SQLite to SQLite)", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		const { counts } = await seedSource(source.knex);
		// a local time that does not exist in New York (spring forward); only SQLite to SQLite can keep it as it is
		await source.knex("user").where("id", 1).update({ created_on: "2026-03-08 02:30:00" });
		const { progress } = await copyAll(source.knex, target.knex, { batchSize: 4 });
		for (const [table, count] of Object.entries(counts))
			assert.equal(await countRows(target.knex, table), count, table);
		// 11 proxy hosts in pages of 4
		assert.deepEqual(
			progress.filter(([table]) => table === "proxy_host").map(([, copied]) => copied),
			[4, 8, 11],
		);
		// SQLite to SQLite keeps the stored text, also a time in the spring-forward gap
		const user = await target.knex("user").where("id", 1).first();
		assert.equal(user.created_on, "2026-03-08 02:30:00");
		assert.equal((await target.knex("proxy_host").where("id", 4).first()).forward_host, "");
		assert.equal((await target.knex("traffic_hour").first()).bytes, 5_000_000_000);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("keeps integers above 2^53 exact (SQLite to SQLite)", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		await addBigRow(source.knex);
		assert.equal(await bigBytes(source.knex), BIG);
		await copyAll(source.knex, target.knex);
		assert.equal(await bigBytes(target.knex), BIG);
		// the verification sees a change of 1 in such a number
		await target.knex.raw("update traffic_hour set bytes = bytes - 1 where host = 'big.example.com'");
		const kinds = await kindsOf(source.knex, target.knex, "traffic_hour");
		await assert.rejects(
			verifyTable({ source: source.knex, target: target.knex, table: "traffic_hour", key: ["id"], kinds }),
			(error) => isMoveError("verify")(error) && error.details.includes(BIG),
		);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("the next insert after the copy gets max id + 1 (SQLite)", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		await copyAll(source.knex, target.knex);
		const info = await target.knex("proxy_host").columnInfo();
		const [id] = await target.knex("proxy_host").insert(fillRow(info, { domain_names: "[]", meta: "{}" }));
		assert.equal(Number(id), 14);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("ids of rows deleted in the database in use are not handed out again (SQLite)", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		// the counter is at 13, the highest id left is 11
		await source.knex("proxy_host").whereIn("id", [12, 13]).delete();
		await copyAll(source.knex, target.knex);
		const info = await target.knex("proxy_host").columnInfo();
		const [id] = await target.knex("proxy_host").insert(fillRow(info, { domain_names: "[]", meta: "{}" }));
		assert.equal(Number(id), 14);
		// a table without rows left keeps its counter too
		await source.knex("audit_log").delete();
		await target.knex("audit_log").delete();
		await resetSequences(source.knex, target.knex, ["audit_log"]);
		const [auditId] = await target
			.knex("audit_log")
			.insert(fillRow(await target.knex("audit_log").columnInfo(), { meta: "{}" }));
		assert.equal(Number(auditId), 2);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("a table that ends on a full page is copied with one more empty read", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		const { progress } = await copyAll(source.knex, target.knex, { batchSize: 7 });
		// 7 users in a page of 7, then an empty page; 11 proxy hosts in 7 and 4
		assert.deepEqual(
			progress.filter(([table]) => table === "user").map(([, copied]) => copied),
			[7],
		);
		assert.deepEqual(
			progress.filter(([table]) => table === "proxy_host").map(([, copied]) => copied),
			[7, 11],
		);
		assert.equal(await countRows(target.knex, "user"), 7);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

// 1203 traffic rows: more than one default page and more than SQLite's 500 terms in one compound SELECT
const addTrafficRows = async (knex) => {
	const rows = Array.from({ length: 1203 }, (_, index) => ({
		bucket: 10 + index,
		host: `t${index}.example.com`,
		status_class: "2xx",
		requests: index,
		bytes: index * 1000,
	}));
	for (let start = 0; start < rows.length; start += 100)
		await knex("traffic_hour").insert(rows.slice(start, start + 100));
};

it("copies more than a page with the default page size (SQLite)", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await addTrafficRows(source.knex);
		const kinds = await kindsOf(source.knex, target.knex, "traffic_hour");
		const progress = [];
		const copied = await copyTable({
			source: source.knex,
			target: target.knex,
			table: "traffic_hour",
			key: ["id"],
			kinds,
			onRows: (rows) => progress.push(rows),
		});
		assert.equal(copied, 1203);
		assert.deepEqual(progress, [500, 1000, 1203]);
		assert.deepEqual(
			await verifyTable({ source: source.knex, target: target.knex, table: "traffic_hour", key: ["id"], kinds }),
			{ count: 1203 },
		);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("a page larger than 500 rows is inserted in SQLite statements of at most 500 rows", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await addTrafficRows(source.knex);
		const kinds = await kindsOf(source.knex, target.knex, "traffic_hour");
		const statements = [];
		target.knex.on("query", ({ sql }) => {
			if (sql.startsWith("insert into `traffic_hour`")) statements.push(sql.split(" union all ").length);
		});
		const copied = await copyTable({
			source: source.knex,
			target: target.knex,
			table: "traffic_hour",
			key: ["id"],
			kinds,
			batchSize: 2000,
		});
		assert.equal(copied, 1203);
		assert.deepEqual(statements, [500, 500, 203]);
		assert.equal(await countRows(target.knex, "traffic_hour"), 1203);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("the verification finds a changed value and a missing row", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		await copyAll(source.knex, target.knex);
		const kinds = await kindsOf(source.knex, target.knex, "setting");
		await target.knex("setting").where("id", "alpha").update({ value: "changed" });
		await assert.rejects(
			verifyTable({ source: source.knex, target: target.knex, table: "setting", key: ["id"], kinds }),
			(error) =>
				isMoveError("verify")(error) &&
				error.message.includes("value") &&
				error.message.includes("alpha") &&
				error.details === 'value: "a" in use, "changed" in the target',
		);
		await target.knex("setting").where("id", "alpha").delete();
		await assert.rejects(
			verifyTable({ source: source.knex, target: target.knex, table: "setting", key: ["id"], kinds }),
			(error) => isMoveError("verify")(error) && error.message.includes("3 rows"),
		);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("a composite key finds the row and its changed column", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await seedSource(source.knex);
		await copyAll(source.knex, target.knex);
		const table = "npmpro_proxy_host_access_list";
		const key = await keyColumns(source.knex, table);
		assert.deepEqual(key, ["proxy_host_id", "location_id", "access_list_id"]);
		const kinds = await kindsOf(source.knex, target.knex, table);
		await target.knex(table).where("access_list_id", 2).update({ position: 5 });
		await assert.rejects(
			verifyTable({ source: source.knex, target: target.knex, table, key, kinds }),
			(error) =>
				isMoveError("verify")(error) &&
				error.message ===
					`${table}: position of the row proxy_host_id=1, location_id=0, access_list_id=2 differs in the target`,
		);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("text keys are verified by key, not by order", { skip: pgSkip, timeout: 120_000 }, async () => {
	// SQLite sorts setting ids binary (Zeta, alpha, default-site), Postgres by its collation (alpha, default-site, Zeta):
	// the first source row must be looked up by its key, a pairing by position would compare Zeta with alpha
	const source = await migratedSqlite();
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await resetPg(pg);
		await runMigrations(pg);
		await copyAll(source.knex, pg);
		const kinds = await kindsOf(source.knex, pg, "setting");
		assert.deepEqual(
			await verifyTable({ source: source.knex, target: pg, table: "setting", key: ["id"], kinds, rows: 1 }),
			{
				count: 3,
			},
		);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
	}
});

it("a row the target refuses fails the copy with the table and the row key, never its values", {
	skip: pgSkip,
	timeout: 120_000,
}, async () => {
	const source = await migratedSqlite();
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		// cut JSON text that Postgres json refuses, holding a secret
		await source.knex("setting").where("id", "default-site").update({ meta: '{"password":"hunter2-secret"' });
		await resetPg(pg);
		await runMigrations(pg);
		const kinds = await kindsOf(source.knex, pg, "setting");
		await assert.rejects(
			copyTable({ source: source.knex, target: pg, table: "setting", key: ["id"], kinds }),
			(error) => {
				assert.ok(isMoveError("copy")(error), String(error));
				assert.equal(error.message, "setting: the target refused the row id=default-site");
				assert.equal(typeof error.details, "string");
				assert.ok(error.details.length > 0);
				for (const text of [error.message, error.details, String(error.cause ?? "")]) {
					assert.ok(!text.includes("hunter2"), text);
				}
				return true;
			},
		);
		// one transaction per table: nothing of the table stays in the target
		assert.equal(await countRows(pg, "setting"), 0);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
	}
});

it("ids of rows deleted in the database in use are not handed out again (Postgres)", {
	skip: pgSkip,
	timeout: 120_000,
}, async () => {
	const source = await migratedSqlite();
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await source.knex("proxy_host").whereIn("id", [12, 13]).delete();
		await resetPg(pg);
		await runMigrations(pg);
		await copyAll(source.knex, pg);
		const info = await pg("proxy_host").columnInfo();
		const [{ id }] = await pg("proxy_host")
			.insert(fillRow(info, { domain_names: "[]", meta: "{}" }))
			.returning("id");
		assert.equal(id, 14);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
	}
});

it("a lost connection during the copy is a copy failure, not a refused row", {
	skip: pgSkip,
	timeout: 120_000,
}, async () => {
	const source = await migratedSqlite();
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await resetPg(pg);
		await runMigrations(pg);
		// every insert into setting ends the session that runs it
		await pg.raw(`create function end_session() returns trigger language plpgsql as $$
			begin perform pg_terminate_backend(pg_backend_pid()); return new; end $$`);
		await pg.raw("create trigger end_session before insert on setting for each row execute function end_session()");
		const kinds = await kindsOf(source.knex, pg, "setting");
		await assert.rejects(
			copyTable({ source: source.knex, target: pg, table: "setting", key: ["id"], kinds }),
			(error) => {
				assert.ok(isMoveError("copy")(error), String(error));
				assert.equal(error.message, "setting: the copy failed");
				assert.ok(error.details.length > 0);
				return true;
			},
		);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
	}
});

it("SQLite to Postgres and back keeps every value", { skip: pgSkip, timeout: 180_000 }, async () => {
	const source = await migratedSqlite();
	const back = await migratedSqlite();
	const pg = knexFactory(knexConfigOf(pgConnection));
	try {
		await seedSource(source.knex);
		await addBigRow(source.knex);
		await resetPg(pg);
		await runMigrations(pg);
		await copyAll(source.knex, pg, { batchSize: 4 });
		const schedule = await pg("npmpro_backup_schedule").first();
		assert.equal(schedule.enabled, false);
		assert.equal(schedule.last_error, "");
		assert.equal(schedule.next_run_at, null);
		assert.equal(schedule.created_on.toISOString(), "2026-10-29T14:00:00.000Z");
		assert.equal((await pg("traffic_hour").where("id", 1).first()).bytes, "5000000000");
		assert.equal((await pg("traffic_hour").where("host", "big.example.com").first()).bytes, BIG);
		assert.deepEqual((await pg("setting").where("id", "alpha").first()).meta, { b: 1, a: 2 });
		// the next insert after the copy gets max id + 1 (Postgres sequence)
		const info = await pg("proxy_host").columnInfo();
		const [{ id }] = await pg("proxy_host")
			.insert(fillRow(info, { domain_names: "[]", meta: "{}" }))
			.returning("id");
		assert.equal(id, 14);
		await pg("proxy_host").where("id", 14).delete();
		const [{ id: userId }] = await pg("user")
			.insert(fillRow(await pg("user").columnInfo()))
			.returning("id");
		assert.equal(userId, 8);
		await pg("user").where("id", 8).delete();
		await copyAll(pg, back.knex, { batchSize: 4 });
		assert.equal(await bigBytes(back.knex), BIG);
		for (const table of ["user", "proxy_host", "setting", "npmpro_backup_schedule", "traffic_hour", "audit_log"]) {
			const before = await source
				.knex(table)
				.select("*")
				.orderBy(await keyColumns(source.knex, table));
			const after = await back
				.knex(table)
				.select("*")
				.orderBy(await keyColumns(back.knex, table));
			assert.equal(after.length, before.length, table);
			for (const [index, row] of before.entries()) {
				for (const [column, value] of Object.entries(row)) {
					// JSON text is compared parsed (Postgres jsonb keeps its own key order and spacing)
					const meaning = JSON_TEXT.has(column) ? JSON.parse : (text) => text;
					assert.deepEqual(meaning(after[index][column]), meaning(value), `${table}.${column}`);
				}
			}
		}
		// SQLite after the copy back keeps the Postgres counters: ids 14 (proxy host) and 8 (user) were handed out and
		// deleted there, so they are not handed out again
		const [nextId] = await back
			.knex("proxy_host")
			.insert(fillRow(await back.knex("proxy_host").columnInfo(), { domain_names: "[]", meta: "{}" }));
		assert.equal(Number(nextId), 15);
		const [nextUserId] = await back.knex("user").insert(fillRow(await back.knex("user").columnInfo()));
		assert.equal(Number(nextUserId), 9);
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await source.cleanup();
		await back.cleanup();
	}
});
