import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { coerceRow, exportRows } from "../lib/backup/rows.js";

const BINARY = /binary/u;

const sqlite = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("proxy_host", (t) => {
		t.increments("id");
		t.dateTime("created_on");
		t.json("domain_names");
		t.json("meta");
		t.integer("enabled");
		t.text("advanced_config");
	});
	return knex;
};

it("exports JSON columns as values and dates as ISO", async () => {
	const knex = await sqlite();
	await knex("proxy_host").insert({
		created_on: "2026-10-26 10:00:00",
		domain_names: '["a.example.com"]',
		meta: "{}",
		enabled: 1,
		advanced_config: "",
	});
	const [row] = await exportRows(knex, "proxy_host");
	assert.deepEqual(row.domain_names, ["a.example.com"]);
	assert.deepEqual(row.meta, {});
	assert.equal(row.enabled, 1);
	await knex.destroy();
});

// mysql and pg return Date objects for date columns; better-sqlite3 returns strings
const stubKnex = (rows) => () => {
	const query = Object.assign(Promise.resolve(rows), { orderBy: () => query, select: () => query });
	return query;
};

it("exports Date values as ISO strings", async () => {
	const rows = await exportRows(
		stubKnex([{ id: 1, created_on: new Date("2026-10-26T10:00:00.000Z") }]),
		"proxy_host",
	);
	assert.equal(rows[0].created_on, "2026-10-26T10:00:00.000Z");
});

it("refuses binary values", async () => {
	const knex = await sqlite();
	await knex("proxy_host").insert({ advanced_config: Buffer.from("x") });
	await assert.rejects(exportRows(knex, "proxy_host"), BINARY);
	await knex.destroy();
});

it("applies the where filter and orders tables without an id column", async () => {
	const knex = await sqlite();
	await knex.schema.createTable("npmpro_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id");
		t.integer("location_id");
		t.integer("access_list_id");
		t.primary(["proxy_host_id", "location_id", "access_list_id"]);
	});
	await knex("npmpro_proxy_host_access_list").insert([
		{ proxy_host_id: 2, location_id: 0, access_list_id: 1 },
		{ proxy_host_id: 1, location_id: 0, access_list_id: 1 },
	]);
	const rows = await exportRows(knex, "npmpro_proxy_host_access_list");
	assert.deepEqual(
		rows.map((r) => r.proxy_host_id),
		[1, 2],
	);
	await knex("proxy_host").insert([{ enabled: 1 }, { enabled: 0 }]);
	const enabled = await exportRows(knex, "proxy_host", (qb) => qb.where("enabled", 1));
	assert.equal(enabled.length, 1);
	await knex.destroy();
});

it("coerces for sqlite: JSON stringified, unknown columns dropped, booleans as 1/0", async () => {
	const knex = await sqlite();
	const columns = { ...(await knex("proxy_host").columnInfo()), __client: "better-sqlite3" };
	const row = coerceRow(columns, "proxy_host", {
		id: 3,
		domain_names: ["a"],
		meta: {},
		enabled: true,
		gone: "x",
		created_on: "2026-10-26T10:00:00.000Z",
	});
	assert.deepEqual(row, { id: 3, domain_names: '["a"]', meta: "{}", enabled: 1, created_on: "2026-10-26 10:00:00" });
	await knex.destroy();
});

it("coerces for postgres booleans and keeps ISO dates", () => {
	const columns = {
		__client: "pg",
		id: { type: "integer" },
		enabled: { type: "boolean" },
		created_on: { type: "timestamp with time zone" },
	};
	assert.deepEqual(coerceRow(columns, "proxy_host", { id: 1, enabled: 1, created_on: "2026-10-26T10:00:00.000Z" }), {
		id: 1,
		enabled: true,
		created_on: "2026-10-26T10:00:00.000Z",
	});
});

it("coerces for mysql dates and keeps null JSON values", () => {
	const columns = { __client: "mysql2", meta: { type: "json" }, modified_on: { type: "datetime" } };
	assert.deepEqual(coerceRow(columns, "setting", { meta: null, modified_on: "2026-10-26T10:00:00.000Z" }), {
		meta: null,
		modified_on: "2026-10-26 10:00:00",
	});
});
