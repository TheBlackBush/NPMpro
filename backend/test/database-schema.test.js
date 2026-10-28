import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
import { up as recacheGravatars } from "../migrations/20260913183435_recache_gravatars.js";
import { up as hardDelete } from "../migrations/20261010135653_hard_delete.js";
import { migratedSqlite, pgConnection, pgSkip, resetPg, tempSqlite } from "./support/database.js";

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
	"traffic_visitor",
	"user",
];

it("builds the whole schema on an empty SQLite database without touching /data", async () => {
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

// the two migrations that load the user module (useNullAsDefault: every inserted row names every column it needs): an empty database skips it, a database with users behaves as before
const memoryKnex = () =>
	knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
const noUserModule = () => {
	throw new Error("the user module must not be loaded");
};

const userTable = (knex) =>
	knex.schema.createTable("user", (t) => {
		t.increments("id");
		t.string("email");
		t.string("name");
		t.string("nickname");
		t.string("avatar");
		t.integer("is_deleted").defaultTo(0);
	});

it("recache_gravatars on an empty database touches no folder and loads no model", async () => {
	const knex = memoryKnex();
	const tmp = await tempSqlite();
	try {
		await userTable(knex);
		const gravatarDir = path.join(tmp.dir, "gravatar");
		await mkdir(gravatarDir);
		await writeFile(path.join(gravatarDir, "1.png"), "old");
		await recacheGravatars(knex, { gravatarDir, loadUser: noUserModule });
		assert.deepEqual(await readdir(gravatarDir), ["1.png"]);
	} finally {
		await knex.destroy();
		await tmp.cleanup();
	}
});

it("recache_gravatars on a database with users clears the folder and re-fetches as before", async () => {
	const knex = memoryKnex();
	const tmp = await tempSqlite();
	try {
		await userTable(knex);
		await knex("user").insert([
			{ id: 1, email: "a@example.com", name: "A", avatar: "", is_deleted: 0 },
			{ id: 2, email: "b@example.com", name: "B", avatar: "/images/avatar/custom.png", is_deleted: 0 },
			{ id: 3, email: "c@example.com", name: "C", avatar: "", is_deleted: 1 },
		]);
		const gravatarDir = path.join(tmp.dir, "gravatar");
		await mkdir(gravatarDir);
		await writeFile(path.join(gravatarDir, "stale.png"), "old");
		const fetched = [];
		const fetchGravatar = (id, email, name) => {
			fetched.push([id, email, name]);
			return `/gravatar/${id}.png`;
		};
		await recacheGravatars(knex, { gravatarDir, loadUser: () => ({ default: { fetchGravatar } }) });
		assert.deepEqual(await readdir(gravatarDir), []);
		assert.deepEqual(fetched, [[1, "a@example.com", "A"]]);
		assert.deepEqual(await knex("user").orderBy("id").pluck("avatar"), [
			"/gravatar/1.png",
			"/images/avatar/custom.png",
			"",
		]);
	} finally {
		await knex.destroy();
		await tmp.cleanup();
	}
});

const hardDeleteTables = async (knex) => {
	await userTable(knex);
	for (const table of ["proxy_host", "redirection_host", "dead_host", "stream", "access_list", "certificate"]) {
		await knex.schema.createTable(table, (t) => {
			t.increments("id");
			t.integer("is_deleted").defaultTo(0);
			if (table === "proxy_host") t.integer("access_list_id").defaultTo(0);
		});
	}
	await knex.schema.createTable("auth", (t) => {
		t.increments("id");
		t.integer("user_id");
		t.integer("is_deleted").defaultTo(0);
	});
	await knex.schema.createTable("user_permission", (t) => {
		t.increments("id");
		t.integer("user_id");
	});
	for (const table of ["access_list_auth", "access_list_client"]) {
		await knex.schema.createTable(table, (t) => {
			t.increments("id");
			t.integer("access_list_id");
		});
	}
	await knex.schema.createTable("npmplus_proxy_host_access_list", (t) => {
		t.integer("proxy_host_id");
		t.integer("access_list_id");
	});
};

it("hard_delete on an empty database loads no model", async () => {
	const knex = memoryKnex();
	try {
		await hardDeleteTables(knex);
		await hardDelete(knex, { loadUser: noUserModule });
		assert.equal((await knex("user").count({ count: "*" }))[0].count, 0);
	} finally {
		await knex.destroy();
	}
});

it("hard_delete on a database with deleted users removes them and their avatars as before", async () => {
	const knex = memoryKnex();
	try {
		await hardDeleteTables(knex);
		await knex("user").insert([
			{ id: 1, email: "a@example.com", name: "A", nickname: "a", avatar: "", is_deleted: 0 },
			{ id: 2, email: "b@example.com", name: "B", nickname: "b", avatar: "", is_deleted: 1 },
		]);
		await knex("auth").insert([{ user_id: 1 }, { user_id: 2 }]);
		await knex("user_permission").insert([{ user_id: 1 }, { user_id: 2 }]);
		await knex("access_list").insert([
			{ id: 1, is_deleted: 0 },
			{ id: 2, is_deleted: 1 },
		]);
		await knex("access_list_client").insert([{ access_list_id: 1 }, { access_list_id: 2 }]);
		await knex("proxy_host").insert([
			{ id: 1, access_list_id: 1, is_deleted: 0 },
			{ id: 2, access_list_id: 0, is_deleted: 1 },
		]);
		await knex("npmplus_proxy_host_access_list").insert([
			{ proxy_host_id: 1, access_list_id: 1 },
			{ proxy_host_id: 2, access_list_id: 1 },
			{ proxy_host_id: 1, access_list_id: 2 },
		]);
		const removed = [];
		const deleteAvatarFiles = (id) => {
			removed.push(id);
		};
		await hardDelete(knex, { loadUser: () => ({ default: { deleteAvatarFiles } }) });
		assert.deepEqual(removed, [2]);
		assert.deepEqual(await knex("user").pluck("id"), [1]);
		assert.deepEqual(await knex("user").pluck("nickname"), [""]);
		assert.deepEqual(await knex("auth").pluck("user_id"), [1]);
		assert.deepEqual(await knex("user_permission").pluck("user_id"), [1]);
		assert.deepEqual(await knex("access_list").pluck("id"), [1]);
		assert.deepEqual(await knex("access_list_client").pluck("access_list_id"), [1]);
		assert.deepEqual(await knex("proxy_host").select("id", "access_list_id"), [{ id: 1, access_list_id: 0 }]);
		assert.deepEqual(await knex("npmplus_proxy_host_access_list").select("proxy_host_id", "access_list_id"), [
			{ proxy_host_id: 1, access_list_id: 1 },
		]);
	} finally {
		await knex.destroy();
	}
});
