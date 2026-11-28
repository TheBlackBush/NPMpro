import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { up } from "../migrations/20261129120000_access_list_countries.js";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-29 10:00:00";
const CODE = /^[A-Z]{2}$/u;
const DOWN = /can't migrate down/u;

// 20261129120000_access_list_countries on SQLite; the Postgres and MySQL checks are in
// test/access-list-country-servers.test.js
it("adds the list columns, the rule comment and the country table, and survives a rerun", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		await knex("access_list").insert({
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			name: "l",
			meta: "{}",
		});
		await knex("access_list_client").insert({
			created_on: NOW,
			modified_on: NOW,
			access_list_id: 1,
			address: "10.0.0.0/8",
			directive: "allow",
			meta: "{}",
		});
		const list = await knex("access_list").first();
		assert.equal(list.npmpro_geo_mode, "off");
		assert.equal(list.npmpro_geo_unknown, "auto");
		assert.equal(Number(list.npmpro_geo_drop), 0);
		assert.equal((await knex("access_list_client").first()).npmpro_comment, "");

		const columns = await knex.raw("pragma table_info(npmpro_access_list_country)");
		assert.deepEqual(
			columns.map((c) => c.name),
			["id", "created_on", "modified_on", "access_list_id", "country", "npmpro_comment"],
		);
		assert.equal(columns.find((c) => c.name === "country").type.toLowerCase(), "varchar(2)");
		const indexes = await knex.raw("pragma index_list(npmpro_access_list_country)");
		assert.equal(indexes.find((i) => i.name === "npmpro_access_list_country_list_country").unique, 1);

		const row = { created_on: NOW, modified_on: NOW, access_list_id: 1, country: "DE" };
		await knex("npmpro_access_list_country").insert(row);
		await assert.rejects(knex("npmpro_access_list_country").insert(row));
		assert.equal((await knex("npmpro_access_list_country").first()).npmpro_comment, "");

		await up(knex);
		assert.equal((await knex("npmpro_access_list_country").count({ count: "*" }))[0].count, 1);
	} finally {
		await db.cleanup();
	}
});

it("keeps down from running", async () => {
	const { down } = await import("../migrations/20261129120000_access_list_countries.js");
	assert.throws(() => down(), DOWN);
});

it("has 250 unique upper case country codes, sorted, with XK", () => {
	const codes = JSON.parse(readFileSync(new URL("../lib/country-codes.json", import.meta.url), "utf8"));
	assert.equal(codes.length, 250);
	assert.equal(new Set(codes).size, 250);
	for (const code of codes) assert.match(code, CODE);
	assert.deepEqual(
		codes,
		codes.toSorted((a, b) => (a < b ? -1 : 1)),
	);
	assert.ok(codes.includes("XK"));
});
