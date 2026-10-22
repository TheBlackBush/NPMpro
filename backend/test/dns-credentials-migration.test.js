import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261023120000_dns_credentials.js";

const setup = async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "dns-mig-"));
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: path.join(dir, "db.sqlite") },
		useNullAsDefault: true,
	});
	await knex.schema.createTable("certificate", (t) => {
		t.increments("id");
		t.integer("owner_user_id").notNull();
		t.integer("npmplus_dns_challenge").notNull().defaultTo(0);
		t.string("npmplus_dns_provider").notNull().defaultTo("");
		t.text("npmplus_dns_provider_credentials").notNull().defaultTo("");
	});
	return knex;
};

const encrypt = (obj) => `enc:${JSON.stringify(obj)}`;

it("groups certificates per owner, provider and credentials text", async () => {
	const knex = await setup();
	await knex("certificate").insert([
		{
			owner_user_id: 1,
			npmplus_dns_challenge: 1,
			npmplus_dns_provider: "cloudflare",
			npmplus_dns_provider_credentials: "a",
		},
		{
			owner_user_id: 1,
			npmplus_dns_challenge: 1,
			npmplus_dns_provider: "cloudflare",
			npmplus_dns_provider_credentials: "a",
		},
		{
			owner_user_id: 1,
			npmplus_dns_challenge: 1,
			npmplus_dns_provider: "cloudflare",
			npmplus_dns_provider_credentials: "b",
		},
		{
			owner_user_id: 2,
			npmplus_dns_challenge: 1,
			npmplus_dns_provider: "cloudflare",
			npmplus_dns_provider_credentials: "a",
		},
		{ owner_user_id: 1, npmplus_dns_challenge: 0, npmplus_dns_provider: "", npmplus_dns_provider_credentials: "" },
	]);

	await up(knex, { encrypt });

	const credentials = await knex("npmplus_dns_credential").orderBy("id");
	assert.deepEqual(
		credentials.map(({ owner_user_id, name, provider, values }) => ({ owner_user_id, name, provider, values })),
		[
			{ owner_user_id: 1, name: "Cloudflare", provider: "cloudflare", values: 'enc:{"ini":"a"}' },
			{ owner_user_id: 1, name: "Cloudflare 2", provider: "cloudflare", values: 'enc:{"ini":"b"}' },
			{ owner_user_id: 2, name: "Cloudflare", provider: "cloudflare", values: 'enc:{"ini":"a"}' },
		],
	);
	const links = (await knex("certificate").orderBy("id")).map((row) => row.npmplus_dns_credential_id);
	assert.deepEqual(links, [credentials[0].id, credentials[0].id, credentials[1].id, credentials[2].id, null]);
	assert.equal(await knex.schema.hasColumn("certificate", "npmplus_dns_provider_credentials"), false);
	await knex.destroy();
});

it("works with no DNS certificates", async () => {
	const knex = await setup();
	await up(knex, { encrypt });
	assert.equal((await knex("npmplus_dns_credential")).length, 0);
	await knex.destroy();
});
