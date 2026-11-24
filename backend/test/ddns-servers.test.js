import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { replaceTypes } from "../lib/backup/restore-db.js";
import { runMigrations } from "../lib/database/schema.js";
import { ENGINES, resetEngine } from "./support/servers.js";

const NOW = "2026-11-24 10:00:00";

// 20261124120000_ddns_records on the real database servers: a 253 character unique name, both foreign keys,
// the history cascade and a rerun
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`DDNS records on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await ctx.knex.schema.createTable("npmpro_dns_credential", (table) => {
				table.increments().primary();
				table.dateTime("created_on").notNull();
				table.dateTime("modified_on").notNull();
				table.integer("owner_user_id").notNull().unsigned();
				table.string("name", 255).notNull();
				table.string("provider", 255).notNull();
				table.text("values").notNull();
			});
			const { up } = await import("../migrations/20261124120000_ddns_records.js");
			await up(ctx.knex);
			await up(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("keeps a 253 character name unique, guards the credential and cascades the history", async () => {
			const [inserted] = await ctx.knex("npmpro_dns_credential").insert(
				{
					created_on: NOW,
					modified_on: NOW,
					owner_user_id: 1,
					name: "c",
					provider: "cloudflare",
					values: "v1:x",
				},
				["id"],
			);
			const credentialId = typeof inserted === "object" ? inserted.id : inserted;
			const domain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
			assert.equal(domain.length, 253);
			const row = {
				created_on: NOW,
				modified_on: NOW,
				owner_user_id: 1,
				dns_credential_id: credentialId,
				provider: "cloudflare",
				name: domain,
				zone: "d".repeat(61),
			};
			const [recordRow] = await ctx.knex("npmpro_ddns_record").insert(row, ["id"]);
			const recordId = typeof recordRow === "object" ? recordRow.id : recordRow;
			await assert.rejects(ctx.knex("npmpro_ddns_record").insert(row));
			await assert.rejects(
				ctx
					.knex("npmpro_ddns_record")
					.insert({ ...row, name: "x.example", dns_credential_id: credentialId + 100 }),
			);
			const stored = await ctx.knex("npmpro_ddns_record").where({ id: recordId }).first();
			assert.equal(stored.ip_version, "ipv4");
			assert.equal(Boolean(Number(stored.enabled)), true);
			assert.equal(stored.state, "pending");
			assert.equal(stored.kind, "address");
			assert.equal(stored.target, null);
			await ctx
				.knex("npmpro_ddns_record")
				.insert({ ...row, name: `*.${"b".repeat(63)}.example`, kind: "alias", target: domain });
			assert.equal((await ctx.knex("npmpro_ddns_record").where({ kind: "alias" }).first()).target, domain);
			assert.equal(Number(stored.failures), 0);

			await ctx
				.knex("npmpro_ddns_history")
				.insert({ ddns_record_id: recordId, created_on: NOW, kind: "created" });
			await assert.rejects(
				ctx
					.knex("npmpro_ddns_history")
					.insert({ ddns_record_id: recordId + 100, created_on: NOW, kind: "created" }),
			);
			await assert.rejects(ctx.knex("npmpro_dns_credential").where({ id: credentialId }).del());
			await ctx.knex("npmpro_ddns_record").where({ id: recordId }).del();
			assert.equal(Number((await ctx.knex("npmpro_ddns_history").count({ count: "*" }))[0].count), 0);
		});
	});
}

// a replace restore of the credentials alone, under records that point to them by a foreign key without cascade; the
// tables come from the real migrations on both servers (the SQLite test schema has JSON defaults MySQL refuses)
for (const [name, label] of [
	["postgres", "Postgres"],
	["mysql", "MySQL"],
]) {
	const engine = ENGINES[name];
	const ctx = {};
	describe(`DDNS records in a credentials restore on ${label}`, { skip: engine.skip, timeout: 120_000 }, () => {
		before(async () => {
			await resetEngine(name);
			ctx.knex = knexFactory({ client: engine.client, connection: engine.connection() });
			await runMigrations(ctx.knex);
		});
		after(() => ctx.knex?.destroy());

		it("keeps the records whose credential and provider stay and removes the others with their history", async () => {
			const { knex } = ctx;
			const box = {
				encrypt: (value) => `v1:${JSON.stringify(value)}`,
				decrypt: (value) => JSON.parse(value.slice(3)),
			};
			const credential = (id, extra = {}) => ({
				id,
				created_on: NOW,
				modified_on: NOW,
				owner_user_id: 1,
				name: `c${id}`,
				provider: "cloudflare",
				values: {},
				...extra,
			});
			await knex("npmpro_dns_credential").insert(
				[1, 2, 3, 4].map((id) => ({ ...credential(id), values: "v1:{}" })),
			);
			const record = (id, credentialId) => ({
				id,
				created_on: NOW,
				modified_on: NOW,
				owner_user_id: 1,
				dns_credential_id: credentialId,
				provider: "cloudflare",
				name: `r${id}.example.com`,
				zone: "example.com",
			});
			await knex("npmpro_ddns_record").insert([record(1, 1), record(2, 2), record(3, 3), record(4, null)]);
			await knex("npmpro_ddns_history").insert(
				[1, 2, 3].map((id) => ({ ddns_record_id: id, created_on: NOW, kind: "changed" })),
			);
			// 1 stays, 2 is gone, 3 changes provider, 4 does not exist in the backup; 5 is new
			const data = {
				dns_credentials: {
					npmpro_dns_credential: [credential(1), credential(3, { provider: "hetzner-cloud" }), credential(5)],
					npmpro_dns_domain: [],
				},
			};
			const result = await replaceTypes({
				knex,
				data,
				types: ["dns_credentials"],
				adminUserId: 1,
				box,
				now: 1_800_000_000,
			});
			assert.equal(result.references.filter((change) => change.remove).length, 2);
			assert.deepEqual(
				(await knex("npmpro_ddns_record").orderBy("id")).map((row) => [Number(row.id), row.dns_credential_id]),
				[
					[1, 1],
					[4, null],
				],
			);
			assert.deepEqual((await knex("npmpro_ddns_history").pluck("ddns_record_id")).map(Number), [1]);
		});
	});
}
