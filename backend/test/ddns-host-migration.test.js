import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-25 10:00:00";
const FILE = "../migrations/20261125120000_ddns_host_records.js";

const indexColumns = async (knex) => {
	const rows = await knex.raw("pragma index_info(npmpro_ddns_record_host)");
	return rows.sort((a, b) => a.seqno - b.seqno).map((row) => row.name);
};

// 20261125120000_ddns_host_records: three nullable columns, the (host_type, host_id) index, old rows stay null, a rerun
it("adds the host columns and index, keeps existing rows null and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		for (const column of ["host_type", "host_id", "origin"])
			assert.equal(await knex.schema.hasColumn("npmpro_ddns_record", column), true, column);
		assert.deepEqual(await indexColumns(knex), ["host_type", "host_id"]);

		const base = {
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			provider: "cloudflare",
			zone: "example.com",
		};
		await knex("npmpro_ddns_record").insert({ ...base, name: "manual.example.com" });
		await knex("npmpro_ddns_record").insert({
			...base,
			name: "host.example.com",
			host_type: "proxy_host",
			host_id: 7,
			origin: "created",
		});
		const manual = await knex("npmpro_ddns_record").where({ name: "manual.example.com" }).first();
		assert.equal(manual.host_type, null);
		assert.equal(manual.host_id, null);
		assert.equal(manual.origin, null);
		const managed = await knex("npmpro_ddns_record").where({ name: "host.example.com" }).first();
		assert.deepEqual([managed.host_type, managed.host_id, managed.origin], ["proxy_host", 7, "created"]);

		// a rerun adds nothing and keeps the rows
		const { up } = await import(FILE);
		await up(knex);
		assert.deepEqual(await indexColumns(knex), ["host_type", "host_id"]);
		assert.equal((await knex("npmpro_ddns_record").count({ count: "*" }))[0].count, 2);
	} finally {
		await db.cleanup();
	}
});

// a run that stopped after the columns: the rerun adds the missing index
it("adds a missing index on a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		await knex.schema.alterTable("npmpro_ddns_record", (table) => {
			table.dropIndex(["host_type", "host_id"], "npmpro_ddns_record_host");
		});
		assert.deepEqual(await indexColumns(knex), []);
		const { up } = await import(FILE);
		await up(knex);
		assert.deepEqual(await indexColumns(knex), ["host_type", "host_id"]);
	} finally {
		await db.cleanup();
	}
});
