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

// keys with one string per plural category: a language holds the categories its counts reach (other always)
const PLURAL_STEMS = ["alerts.subject.problems", "alerts.subject.resolved", "alerts.days"];
const COUNTS = 1000;
const categoriesOf = (code) => {
	const rules = new Intl.PluralRules(code);
	return new Set(["other", ...Array.from({ length: COUNTS + 1 }, (_, count) => rules.select(count))]);
};
const stemOf = (key) => PLURAL_STEMS.find((stem) => key.startsWith(`${stem}.`));

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
			const plain = (keys) => keys.filter((key) => !stemOf(key)).sort(byText);
			assert.deepEqual(plain(Object.keys(table)), plain(Object.keys(english)));
			for (const stem of PLURAL_STEMS) {
				const found = Object.keys(table)
					.filter((key) => stemOf(key) === stem)
					.map((key) => key.slice(stem.length + 1))
					.sort(byText);
				assert.deepEqual(found, [...categoriesOf(code)].sort(byText), `${code} ${stem}`);
			}
			for (const [key, text] of Object.entries(table)) {
				assert.equal(typeof text, "string", key);
				assert.ok(text.trim() !== "", key);
				assert.ok(!text.includes("\u2014"), key);
				const reference = stemOf(key) ? english[`${stemOf(key)}.other`] : english[key];
				assert.deepEqual(placeholders(text), placeholders(reference), key);
			}
		});
	}
});
