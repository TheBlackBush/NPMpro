import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { coerceRow, exportRows } from "../lib/backup/rows.js";

// the app stores local time; a zone with an offset shows a shift
process.env.TZ = "Asia/Jerusalem";

it("round trips a SQLite local date with the same wall-clock time", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.dateTime("expires_on");
		t.string("nice_name");
	});
	await knex("certificate").insert({ expires_on: "2026-10-26 10:00:00", nice_name: "2026-10-26 10:00:00" });
	const [row] = await exportRows(knex, "certificate");
	assert.equal(row.expires_on, "2026-10-26T08:00:00.000Z");
	assert.equal(row.nice_name, "2026-10-26 10:00:00");
	const columns = { ...(await knex("certificate").columnInfo()), __client: "better-sqlite3" };
	assert.equal(coerceRow(columns, "certificate", row).expires_on, "2026-10-26 10:00:00");
	assert.equal(
		coerceRow({ __client: "mysql2", expires_on: { type: "datetime" } }, "certificate", row).expires_on,
		"2026-10-26 10:00:00",
	);
	assert.equal(
		coerceRow({ __client: "pg", expires_on: { type: "timestamp with time zone" } }, "certificate", row).expires_on,
		"2026-10-26T08:00:00.000Z",
	);
	await knex.destroy();
});

it("round trips a MySQL date (read by mysql2 as local time) with the same wall-clock time", async () => {
	// mysql2 with timezone "local" turns the stored 2026-10-26 10:00:00 into this Date
	const stored = new Date(2026, 9, 26, 10, 0, 0);
	const stubKnex = () => {
		const query = Object.assign(Promise.resolve([{ id: 1, expires_on: stored }]), {
			orderBy: () => query,
			select: () => query,
		});
		return query;
	};
	stubKnex.client = { config: { client: "mysql2" } };
	const [row] = await exportRows(stubKnex, "certificate");
	assert.equal(row.expires_on, "2026-10-26T08:00:00.000Z");
	assert.equal(
		coerceRow({ __client: "mysql2", expires_on: { type: "datetime" } }, "certificate", row).expires_on,
		"2026-10-26 10:00:00",
	);
});
