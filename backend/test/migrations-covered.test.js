import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { it } from "node:test";
import { migrationNames } from "./support/migrations.js";

const CHANGES_DATA = /\.(?:update|insert|del|delete)\(|\.raw\(/u;
const here = new URL("./", import.meta.url);
const folder = new URL("../migrations/", import.meta.url);

it("every migration that changes data is named by a test", async () => {
	const tests = await readdir(here);
	const texts = await Promise.all(
		tests.filter((name) => name.endsWith(".test.js")).map((name) => readFile(new URL(name, here), "utf8")),
	);
	const missing = [];
	for (const name of await migrationNames()) {
		if (!CHANGES_DATA.test(await readFile(new URL(name, folder), "utf8"))) continue;
		const stem = name.replace(/\.js$/u, "");
		if (!texts.some((text) => text.includes(stem))) missing.push(name);
	}
	assert.deepEqual(missing, []);
});
