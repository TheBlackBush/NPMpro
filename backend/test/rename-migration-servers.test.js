import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import knexFactory from "knex";
import { up } from "../migrations/20261023180000_rename_to_npmpro.js";

// Runs only against test servers given by URL, for example from a local Docker run
const servers = [
	{ label: "postgres", client: "pg", url: process.env.TEST_PG_URL },
	{ label: "mysql", client: "mysql2", url: process.env.TEST_MYSQL_URL },
	{ label: "mariadb", client: "mysql2", url: process.env.TEST_MARIADB_URL },
];

const indexQuery = {
	pg: "SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema()",
	mysql2: "SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'",
};
const rowsOf = (client, result) => (client === "pg" ? result.rows : result[0]);
const tables = ["proxy_host", "npmplus_location", "npmpro_location", "npmplus_dns_credential", "npmpro_dns_credential"];

for (const { label, client, url } of servers) {
	// no URL means no server to test against, so the suite is skipped
	const suite = url ? describe : describe.skip;
	suite(`rename migration on ${label}`, () => {
		let knex;

		before(async () => {
			knex = knexFactory({ client, connection: url });
			for (const table of tables) {
				await knex.schema.dropTableIfExists(table);
			}
			await knex.schema.createTable("proxy_host", (t) => {
				t.increments("id");
				t.string("forward_host").notNull();
				t.integer("npmplus_http3_support").notNull().defaultTo(0);
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
			await knex("proxy_host").insert({ forward_host: "a", npmplus_http3_support: 1 });
			await knex("npmplus_location").insert({ proxy_host_id: 1, npmplus_access_list_type: "any" });
			await knex("npmplus_dns_credential").insert({ owner_user_id: 1, name: "cf" });
		});

		after(async () => {
			await knex?.destroy();
		});

		it("renames tables, columns, indexes and sequences and keeps the data", async () => {
			await up(knex);

			assert.deepEqual(await knex("proxy_host").select(), [
				{ id: 1, forward_host: "a", npmpro_http3_support: 1 },
			]);
			assert.deepEqual(await knex("npmpro_location").select(), [
				{ id: 1, proxy_host_id: 1, npmpro_access_list_type: "any" },
			]);
			assert.deepEqual(await knex("npmpro_dns_credential").select(), [{ id: 1, owner_user_id: 1, name: "cf" }]);

			const indexes = rowsOf(client, await knex.raw(indexQuery[client])).map((row) => row.name);
			assert.deepEqual(
				indexes.filter((name) => name.includes("npmplus")),
				[],
			);
			assert.ok(indexes.includes("npmpro_location_proxy_host_id_index"));
			assert.ok(indexes.includes("npmpro_dns_credential_owner_user_id_name_unique"));
			await assert.rejects(knex("npmpro_dns_credential").insert({ owner_user_id: 1, name: "cf" }));

			if (client === "pg") {
				const sequences = rowsOf(
					client,
					await knex.raw(
						"SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = current_schema()",
					),
				).map((row) => row.name);
				assert.deepEqual(
					sequences.filter((name) => name.includes("npmplus")),
					[],
				);
			}

			// ids still come from the renamed sequence or auto increment
			const [inserted] = await knex("npmpro_location")
				.insert({ proxy_host_id: 1, npmpro_access_list_type: "x" })
				.returning("id");
			assert.equal(typeof inserted === "object" ? inserted.id : inserted, 2);
		});

		it("is a no-op when run a second time", async () => {
			await up(knex);
			assert.deepEqual(Object.keys(await knex("proxy_host").columnInfo()).sort(), [
				"forward_host",
				"id",
				"npmpro_http3_support",
			]);
		});
	});

	if (client === "pg") {
		const suite = url ? describe : describe.skip;
		suite("rename migration inside a transaction on postgres", () => {
			let knex;
			const all = [
				"proxy_host",
				"npmplus_location",
				"npmpro_location",
				"npmplus_dns_credential",
				"npmpro_dns_credential",
				"other",
			];

			before(async () => {
				knex = knexFactory({ client, connection: url });
				for (const table of all) {
					await knex.schema.dropTableIfExists(table);
				}
				await knex.schema.createTable("other", (t) => {
					t.increments("id");
					t.integer("a");
				});
				// the rename target of npmplus_location_proxy_host_id_index already exists
				await knex.raw("CREATE INDEX ?? ON other (a)", ["npmpro_location_proxy_host_id_index"]);
				await knex.schema.createTable("npmplus_location", (t) => {
					t.increments("id");
					t.integer("proxy_host_id").notNull().unsigned().index();
					t.string("npmplus_kind").notNull().defaultTo("");
				});
				await knex.schema.createTable("npmplus_dns_credential", (t) => {
					t.increments("id");
					t.integer("owner_user_id").notNull();
					t.string("name").notNull();
					t.unique(["owner_user_id", "name"]);
				});
			});

			after(async () => {
				for (const table of all) {
					await knex?.schema.dropTableIfExists(table);
				}
				await knex?.destroy();
			});

			it("commits and only the conflicting index keeps its old name", async () => {
				await knex.transaction((trx) => up(trx));

				assert.deepEqual(Object.keys(await knex("npmpro_location").columnInfo()).sort(), [
					"id",
					"npmpro_kind",
					"proxy_host_id",
				]);
				await knex("npmpro_dns_credential").select();
				const names = rowsOf(client, await knex.raw(indexQuery.pg)).map((row) => row.name);
				assert.deepEqual(
					names.filter((name) => name.includes("npmplus")),
					["npmplus_location_proxy_host_id_index"],
				);
				assert.ok(names.includes("npmpro_dns_credential_owner_user_id_name_unique"));
				const sequences = rowsOf(
					client,
					await knex.raw(
						"SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = current_schema()",
					),
				).map((row) => row.name);
				assert.deepEqual(
					sequences.filter((name) => name.includes("npmplus")),
					[],
				);
			});
		});
	}
}
