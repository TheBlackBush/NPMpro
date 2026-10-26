import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { up as monitoringUp } from "../migrations/20261024120000_monitoring.js";
import { up } from "../migrations/20261026110000_traffic_indexes.js";

const indexes = async (knex) =>
	(await knex("sqlite_master").where("type", "index").whereLike("name", "t%").select("name"))
		.map((row) => row.name)
		.sort();

it("drops the bucket-only traffic indexes and adds host, bucket ones; a rerun is harmless", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await monitoringUp(knex);
	assert.ok((await indexes(knex)).includes("tm_bucket"));
	await up(knex);
	await up(knex);
	const after = await indexes(knex);
	for (const short of ["tm", "th", "tch", "tah", "tih"]) {
		assert.equal(after.includes(`${short}_bucket`), false, short);
		assert.ok(after.includes(`${short}_hb`), short);
		assert.ok(after.includes(`${short}_uq`), short);
	}
	await knex.destroy();
});
