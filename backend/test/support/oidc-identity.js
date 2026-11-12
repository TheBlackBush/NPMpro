import assert from "node:assert/strict";
import { it } from "node:test";
import { up } from "../../migrations/20261112120000_oidc_identity_link.js";

// 20261112120000_oidc_identity_link on each database engine: many unlinked users (NULL pairs), one user per linked
// identity, the same subject at another issuer is another identity, and values compare exactly (case too).
// ctx.knex: a database with a user table of id, email and name.

const ISSUER = "https://idp.example.com";

const oidcLinkTests = (ctx) => {
	it("adds the link columns and the identity index; a rerun is harmless", async () => {
		const { knex } = ctx;
		await up(knex);
		await up(knex);
		await knex("user").insert([
			{ email: "a@example.com", name: "A" },
			{ email: "b@example.com", name: "B" },
		]);
		const first = await knex("user").where({ email: "a@example.com" }).first();
		assert.equal(first.npmpro_oidc_issuer, null);
		assert.equal(first.npmpro_oidc_subject, null);
		assert.equal(first.npmpro_oidc_linked_on, null);
		assert.equal((await knex("user").whereNull("npmpro_oidc_subject")).length, 2);
		await knex("user")
			.where({ email: "a@example.com" })
			.update({ npmpro_oidc_issuer: ISSUER, npmpro_oidc_subject: "s1" });
		await assert.rejects(
			knex("user")
				.where({ email: "b@example.com" })
				.update({ npmpro_oidc_issuer: ISSUER, npmpro_oidc_subject: "s1" }),
		);
		await knex("user")
			.where({ email: "b@example.com" })
			.update({ npmpro_oidc_issuer: "https://other.example.com", npmpro_oidc_subject: "s1" });
	});

	it("compares the issuer and subject exactly: a subject that differs only in case is another identity", async () => {
		const { knex } = ctx;
		await knex("user").insert({ email: "c@example.com", name: "C" });
		await knex("user")
			.where({ email: "c@example.com" })
			.update({ npmpro_oidc_issuer: ISSUER, npmpro_oidc_subject: "S1" });
		const found = await knex("user").where({ npmpro_oidc_issuer: ISSUER, npmpro_oidc_subject: "s1" });
		assert.deepEqual(
			found.map((row) => row.email),
			["a@example.com"],
		);
	});
};

export { oidcLinkTests };
