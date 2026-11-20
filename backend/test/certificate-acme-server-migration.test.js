import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";

// 20261120120000_certificate_acme_server: the nullable column, a rerun after a partial run
it("adds certificate.npmpro_acme_server, null by default", async () => {
	const db = await migratedSqlite();
	try {
		const { knex } = db;
		assert.equal(await knex.schema.hasColumn("certificate", "npmpro_acme_server"), true);
		const [id] = await knex("certificate").insert({
			owner_user_id: 1,
			created_on: "2026-11-20 10:00:00",
			modified_on: "2026-11-20 10:00:00",
			provider: "letsencrypt",
			domain_names: "[]",
			expires_on: "2026-11-20 10:00:00",
			meta: "{}",
		});
		assert.equal((await knex("certificate").where({ id }).first()).npmpro_acme_server, null);
		const { up } = await import("../migrations/20261120120000_certificate_acme_server.js");
		await up(knex);
	} finally {
		await db.cleanup();
	}
});
