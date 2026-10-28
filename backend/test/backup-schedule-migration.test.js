import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261028120000_backup_schedules.js";

const env = process.env;
const skip = env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set";

const roundTrip = async (knex) => {
	await up(knex);
	await up(knex); // a rerun is safe
	const now = knex.client.config.client === "pg" ? new Date() : "2026-10-28 12:00:00";
	await knex("npmpro_backup_schedule").insert({
		created_on: now,
		modified_on: now,
		owner_user_id: 1,
		name: "Nightly",
		enabled: true,
		frequency: "daily",
		time: "03:00",
		types: JSON.stringify(["proxy_hosts"]),
		protection: "none",
		keep: 7,
		last_size: 5_000_000_000,
	});
	const row = await knex("npmpro_backup_schedule").first();
	assert.equal(row.name, "Nightly");
	assert.equal(Boolean(Number(row.enabled)), true);
	assert.equal(Number(row.last_size), 5_000_000_000);
	assert.equal(row.next_run_at, null);
	await assert.rejects(knex("npmpro_backup_schedule").insert({ ...row, id: undefined }));
};

it("creates the table on SQLite", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	try {
		await roundTrip(knex);
	} finally {
		await knex.destroy();
	}
});

it("creates the table on Postgres", { skip, timeout: 60_000 }, async () => {
	const knex = knexFactory({
		client: "pg",
		connection: {
			host: env.POSTGRES_NPMPRO_HOST,
			port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
			user: env.POSTGRES_NPMPRO_USER,
			password: env.POSTGRES_NPMPRO_PASS,
			database: "npmpro_test_unit",
		},
	});
	try {
		await knex.raw("drop schema public cascade");
		await knex.raw("create schema public");
		await roundTrip(knex);
	} finally {
		await knex.destroy();
	}
});
