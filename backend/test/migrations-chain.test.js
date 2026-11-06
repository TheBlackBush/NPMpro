import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { it } from "node:test";
import { migratedSqlite } from "./support/database.js";
import { schemaSnapshot } from "./support/migrations.js";

const SNAPSHOT = new URL("./fixtures/schema-snapshot.json", import.meta.url);

it("builds the committed schema from an empty database", async () => {
	const db = await migratedSqlite();
	try {
		const actual = await schemaSnapshot(db.knex);
		if (process.env.UPDATE_SCHEMA_SNAPSHOT) await writeFile(SNAPSHOT, `${JSON.stringify(actual, null, "\t")}\n`);
		assert.deepEqual(actual, JSON.parse(await readFile(SNAPSHOT, "utf8")));
	} finally {
		await db.cleanup();
	}
});
