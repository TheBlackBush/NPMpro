import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { clientOf, rowsOf, up } from "../migrations/20261023180000_rename_to_npmpro.js";

const setup = async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "rename-mig-"));
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: path.join(dir, "db.sqlite") },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("proxy_host", (t) => {
		t.increments("id");
		t.string("forward_host").notNull();
		t.integer("npmplus_http3_support").notNull().defaultTo(0);
		t.text("npmplus_advanced_config").notNull().defaultTo("");
	});
	await knex.schema.createTable("npmplus_location", (t) => {
		t.increments("id");
		t.integer("proxy_host_id").notNull().unsigned().index();
		t.string("npmplus_access_list_type").notNull().defaultTo("");
	});
	await knex.schema.createTable("npmplus_dns_credential", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull();
		t.string("name").notNull();
		t.unique(["owner_user_id", "name"]);
	});
	// a table and column the spec does not list, to prove discovery
	await knex.schema.createTable("some_future_table", (t) => {
		t.increments("id");
		t.string("npmplus_future_flag").notNull().defaultTo("x");
	});
	await knex("proxy_host").insert({ forward_host: "a", npmplus_http3_support: 1, npmplus_advanced_config: "cfg" });
	await knex("npmplus_location").insert({ proxy_host_id: 1, npmplus_access_list_type: "any" });
	await knex("npmplus_dns_credential").insert({ owner_user_id: 1, name: "cf" });
	await knex("some_future_table").insert({});
	return knex;
};

const indexNames = async (knex) =>
	(await knex.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")).map(
		(row) => row.name,
	);

it("renames tables, columns and indexes and keeps the data", async () => {
	const knex = await setup();
	await up(knex);

	assert.equal(await knex.schema.hasTable("npmplus_location"), false);
	assert.equal(await knex.schema.hasTable("npmplus_dns_credential"), false);
	assert.deepEqual(await knex("proxy_host").select(), [
		{ id: 1, forward_host: "a", npmpro_http3_support: 1, npmpro_advanced_config: "cfg" },
	]);
	assert.deepEqual(await knex("npmpro_location").select(), [
		{ id: 1, proxy_host_id: 1, npmpro_access_list_type: "any" },
	]);
	assert.deepEqual(await knex("npmpro_dns_credential").select(), [{ id: 1, owner_user_id: 1, name: "cf" }]);
	assert.deepEqual(await knex("some_future_table").select(), [{ id: 1, npmpro_future_flag: "x" }]);
	assert.deepEqual(await indexNames(knex), [
		"npmpro_dns_credential_owner_user_id_name_unique",
		"npmpro_location_proxy_host_id_index",
	]);
	await assert.rejects(
		knex("npmpro_dns_credential").insert({ owner_user_id: 1, name: "cf" }),
		/UNIQUE constraint failed/u,
	);
	await knex.destroy();
});

it("is a no-op when run a second time", async () => {
	const knex = await setup();
	await up(knex);
	await up(knex);
	assert.deepEqual(Object.keys(await knex("proxy_host").columnInfo()).sort(), [
		"forward_host",
		"id",
		"npmpro_advanced_config",
		"npmpro_http3_support",
	]);
	await knex.destroy();
});

it("refuses to continue when old and new column names both exist", async () => {
	const knex = await setup();
	await knex.schema.alterTable("proxy_host", (t) => {
		t.integer("npmpro_http3_support").notNull().defaultTo(0);
	});
	await assert.rejects(up(knex), /proxy_host\.npmplus_http3_support and npmpro_http3_support/u);
	await knex.destroy();
});

it("refuses to continue when old and new table names both exist", async () => {
	const knex = await setup();
	await knex.schema.createTable("npmpro_location", (t) => {
		t.increments("id");
	});
	await assert.rejects(up(knex), /npmplus_location and npmpro_location/u);
	await knex.destroy();
});

it("maps knex client names to a family", () => {
	const fake = (client) => ({ client: { config: { client } } });
	assert.equal(clientOf(fake("better-sqlite3")), "sqlite");
	assert.equal(clientOf(fake("mysql2")), "mysql");
	assert.equal(clientOf(fake("pg")), "pg");
});

it("reads rows from each client's raw result shape", () => {
	const rows = [{ name: "a" }];
	assert.deepEqual(rowsOf("sqlite", rows), rows);
	assert.deepEqual(rowsOf("mysql", [rows, []]), rows);
	assert.deepEqual(rowsOf("pg", { rows }), rows);
});
