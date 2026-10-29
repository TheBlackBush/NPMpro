import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { knexConfigOf } from "../lib/database/knex-config.js";
import {
	compareSchemas,
	dataTables,
	foreignKeys,
	keyColumns,
	runMigrations,
	tableOrder,
} from "../lib/database/schema.js";
import errs from "../lib/error.js";
import { migratedSqlite, pgConnection, pgSkip, resetPg } from "./support/database.js";

const isMoveError = (code) => (error) => error instanceof errs.DatabaseMoveError && error.code === code;

// the tables the migrations create today; a new migration adds to this list, it is not a copy allowlist
const KNOWN = [
	"access_list",
	"audit_log",
	"auth",
	"certificate",
	"npmpro_backup_schedule",
	"npmpro_dns_credential",
	"npmpro_location",
	"npmpro_proxy_host_access_list",
	"proxy_host",
	"session_revocation",
	"setting",
	"stream",
	"traffic_hour",
	"traffic_path_hour",
	"traffic_visitor",
	"user",
];

it("builds the whole schema on an empty SQLite database", async () => {
	const db = await migratedSqlite();
	try {
		const tables = await dataTables(db.knex);
		for (const table of KNOWN) assert.ok(tables.includes(table), table);
		assert.equal(tables.includes("migrations"), false);
		assert.equal(tables.includes("migrations_lock"), false);
		for (const table of tables) {
			const [{ count }] = await db.knex(table).count({ count: "*" });
			assert.equal(Number(count), 0, `${table} is empty after the migrations`);
		}
	} finally {
		await db.cleanup();
	}
});

it("orders parents first, ties alphabetically, and refuses cycles", () => {
	assert.deepEqual(
		tableOrder(
			["c_child", "b_parent", "a_free", "d_grandchild"],
			[
				{ table: "c_child", references: "b_parent" },
				{ table: "d_grandchild", references: "c_child" },
				{ table: "a_free", references: "a_free" },
				{ table: "a_free", references: "not_copied" },
			],
		),
		["a_free", "b_parent", "c_child", "d_grandchild"],
	);
	assert.throws(
		() =>
			tableOrder(
				["x", "y"],
				[
					{ table: "x", references: "y" },
					{ table: "y", references: "x" },
				],
			),
		isMoveError("schema-mismatch"),
	);
});

it("reads foreign keys and primary keys from the schema", async () => {
	const db = await migratedSqlite();
	try {
		await db.knex.schema.createTable("zz_parent", (t) => t.increments("id"));
		await db.knex.schema.createTable("zz_child", (t) => {
			t.increments("id");
			t.integer("parent_id").references("zz_parent.id");
		});
		await db.knex.schema.createTable("zz_nokey", (t) => {
			t.integer("b");
			t.string("a");
			t.json("meta");
		});
		assert.deepEqual(
			(await foreignKeys(db.knex)).filter((key) => key.table.startsWith("zz_")),
			[{ table: "zz_child", references: "zz_parent" }],
		);
		assert.deepEqual(await keyColumns(db.knex, "setting"), ["id"]);
		assert.deepEqual(await keyColumns(db.knex, "npmpro_proxy_host_access_list"), [
			"proxy_host_id",
			"location_id",
			"access_list_id",
		]);
		assert.deepEqual(await keyColumns(db.knex, "zz_nokey"), ["a", "b"]);
	} finally {
		await db.cleanup();
	}
});

it("a table only in the database in use stops the move", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		const same = await compareSchemas(source.knex, target.knex);
		assert.deepEqual(same.tables, await dataTables(source.knex));
		assert.ok(same.info.proxy_host.source.domain_names);
		await source.knex.schema.createTable("custom_extra", (t) => t.increments());
		await assert.rejects(
			compareSchemas(source.knex, target.knex),
			(error) => isMoveError("schema-mismatch")(error) && error.message.includes("custom_extra"),
		);
		await source.knex.schema.dropTable("custom_extra");
		await target.knex.schema.alterTable("setting", (t) => t.string("extra"));
		await assert.rejects(
			compareSchemas(source.knex, target.knex),
			(error) => isMoveError("schema-mismatch")(error) && error.message.includes("setting"),
		);
		await target.knex.schema.alterTable("setting", (t) => t.dropColumn("extra"));
		await target.knex("migrations").where("name", "20261028120000_backup_schedules.js").delete();
		await assert.rejects(compareSchemas(source.knex, target.knex), isMoveError("schema-mismatch"));
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});

it("builds the same tables and columns on Postgres", { skip: pgSkip, timeout: 120_000 }, async () => {
	const pg = knexFactory(knexConfigOf(pgConnection));
	const lite = await migratedSqlite();
	try {
		await resetPg(pg);
		await runMigrations(pg);
		const { tables } = await compareSchemas(lite.knex, pg);
		assert.ok(tables.includes("proxy_host"));
		assert.deepEqual(await keyColumns(pg, "user"), ["id"]);
		assert.deepEqual(await keyColumns(pg, "npmpro_proxy_host_access_list"), [
			"proxy_host_id",
			"location_id",
			"access_list_id",
		]);
		assert.ok(Array.isArray(await foreignKeys(pg)));
	} finally {
		await resetPg(pg);
		await pg.destroy();
		await lite.cleanup();
	}
});

it("a database in use that is behind on migrations stops the move", async () => {
	const source = await migratedSqlite();
	const target = await migratedSqlite();
	try {
		await source.knex.schema.dropTable("npmpro_backup_schedule");
		await source.knex("migrations").where("name", "20261028120000_backup_schedules.js").delete();
		await assert.rejects(
			compareSchemas(source.knex, target.knex),
			(error) =>
				isMoveError("schema-mismatch")(error) &&
				error.message.includes("only in the target: npmpro_backup_schedule"),
		);
	} finally {
		await source.cleanup();
		await target.cleanup();
	}
});
