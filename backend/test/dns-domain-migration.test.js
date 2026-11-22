import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

const NOW = "2026-11-23 10:00:00";

// 20261123120000_dns_domains: the table, its unique (credential, name), the default source, a rerun
it("creates npmpro_dns_domain with a unique name per credential and the typed source by default", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		for (const column of ["id", "created_on", "modified_on", "dns_credential_id", "name", "source"]) {
			assert.equal(await knex.schema.hasColumn("npmpro_dns_domain", column), true, column);
		}
		const [credentialId] = await knex("npmpro_dns_credential").insert({
			created_on: NOW,
			modified_on: NOW,
			owner_user_id: 1,
			name: "Cloudflare main",
			provider: "cloudflare",
			values: "v1:x:y:z",
		});
		const row = { created_on: NOW, modified_on: NOW, dns_credential_id: credentialId, name: "example.com" };
		await knex("npmpro_dns_domain").insert(row);
		await assert.rejects(knex("npmpro_dns_domain").insert(row));
		await knex("npmpro_dns_domain").insert({ ...row, name: `${"a".repeat(241)}.example.com` });
		assert.equal((await knex("npmpro_dns_domain").where("name", "example.com").first()).source, "typed");
		const { up } = await import("../migrations/20261123120000_dns_domains.js");
		await up(knex);
		assert.equal((await knex("npmpro_dns_domain").count({ count: "*" }))[0].count, 2);
	} finally {
		await db.cleanup();
	}
});
