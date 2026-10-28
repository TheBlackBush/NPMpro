import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge } from "../lib/backup/merge-plan.js";
import { createSchema } from "./support/backup-schema.js";

const env = process.env;
const skip = env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set";
const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };

const connect = () =>
	knexFactory({
		client: "pg",
		connection: {
			host: env.POSTGRES_NPMPRO_HOST,
			port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
			user: env.POSTGRES_NPMPRO_USER,
			password: env.POSTGRES_NPMPRO_PASS,
			database: "npmpro_test_unit",
		},
	});

it("adds rows with free ids after rows were inserted with explicit ids (Postgres)", {
	skip,
	timeout: 60_000,
}, async () => {
	const knex = connect();
	try {
		await knex.raw("drop schema public cascade");
		await knex.raw("create schema public");
		await createSchema(knex);
		// a PR 1 replace inserts with explicit ids and leaves the sequence behind
		await knex("proxy_host").insert({ id: 7, domain_names: JSON.stringify(["old.example.com"]) });
		const data = {
			proxy_hosts: {
				proxy_host: [
					{
						id: 7,
						owner_user_id: 1,
						domain_names: ["new.example.com"],
						certificate_id: 0,
						npmpro_mtls_certificate_id: 0,
						access_list_id: 0,
						enabled: 1,
						meta: {},
					},
				],
				npmpro_location: [],
				npmpro_proxy_host_access_list: [],
			},
		};
		const instance = {
			proxy_host: await knex("proxy_host").select("id", "domain_names"),
			redirection_host: [],
			dead_host: [],
			stream: [],
			certificate: [],
			access_list: [],
			npmpro_dns_credential: [],
			user: await knex("user").select("id", "email"),
			setting: [],
			files: {},
		};
		const scope = {
			adminUserId: 1,
			importerId: 1,
			page: false,
			canView: () => true,
			canManage: () => true,
			canEdit: () => true,
			visibleOwnerId: null,
		};
		const plan = planMerge({ data, instance, stageFiles: {}, types: ["proxy_hosts"], scope, secrets: true });
		const result = await mergeTypes({
			knex,
			data,
			plan,
			adminUserId: 1,
			importerId: 1,
			box,
			secrets: true,
			now: 1,
		});
		const newId = result.maps.proxy_host.get("7");
		assert.notEqual(newId, 7);
		assert.equal(
			(await knex("proxy_host").where({ id: newId }).first()).domain_names.includes("new.example.com"),
			true,
		);
	} finally {
		await knex.raw("drop schema public cascade").catch(() => undefined);
		await knex.raw("create schema public").catch(() => undefined);
		await knex.destroy();
	}
});
