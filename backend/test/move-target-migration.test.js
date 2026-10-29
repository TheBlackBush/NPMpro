import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { up as recacheGravatars } from "../migrations/20260913183435_recache_gravatars.js";
import { up as hardDelete } from "../migrations/20261010135653_hard_delete.js";
import { tempSqlite } from "./support/database.js";

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
