import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";

const KEPT = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru", "uk", "zh"];
const root = new URL("../../translations/", import.meta.url);

it("lang-list.json lists exactly the 13 kept languages", () => {
	const list = JSON.parse(readFileSync(new URL("lang-list.json", root), "utf8"));
	assert.deepEqual(Object.keys(list).sort(), KEPT);
});

it("ui and help hold exactly the 13 kept languages", () => {
	const ui = readdirSync(new URL("ui/", root))
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.slice(0, -5));
	const help = readdirSync(new URL("help/", root), { withFileTypes: true }).filter(
		(d) => d.isDirectory() && !d.name.startsWith("."),
	);
	assert.deepEqual(ui.sort(), KEPT);
	assert.deepEqual(help.map((d) => d.name).sort(), KEPT);
});
