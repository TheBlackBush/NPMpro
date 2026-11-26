import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MAIL_LANGUAGES } from "../lib/mail/settings-rules.js";

const FOLDER = new URL("../mail/translations/", import.meta.url);
const load = (code) => JSON.parse(fs.readFileSync(new URL(`${code}.json`, FOLDER), "utf8"));
const PLACEHOLDER = /\{(?<name>\w+)\}/gu;
const JSON_SUFFIX = /\.json$/u;
const byText = (a, b) => a.localeCompare(b);
const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((match) => match.groups.name).sort(byText);

describe("mail translations", () => {
	const english = load("en");

	it("has one file per mail language and no other", () => {
		assert.deepEqual(
			fs
				.readdirSync(FOLDER)
				.map((file) => file.replace(JSON_SUFFIX, ""))
				.sort(byText),
			[...MAIL_LANGUAGES].sort(byText),
		);
	});

	for (const code of MAIL_LANGUAGES) {
		it(`${code}: the keys of en.json, no empty value, no em dash, the same placeholders`, () => {
			const table = load(code);
			assert.deepEqual(Object.keys(table).sort(byText), Object.keys(english).sort(byText));
			for (const [key, text] of Object.entries(table)) {
				assert.equal(typeof text, "string", key);
				assert.ok(text.trim() !== "", key);
				assert.ok(!text.includes("\u2014"), key);
				assert.deepEqual(placeholders(text), placeholders(english[key]), key);
			}
		});
	}
});
