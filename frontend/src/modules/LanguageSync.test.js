import assert from "node:assert/strict";
import { it } from "node:test";
import { createLanguageSync, languageNeedsSync } from "./LanguageSync.js";

it("does not sync while the user is loading", () => {
	assert.equal(languageNeedsSync(undefined, "de"), false);
});

it("syncs when the stored language is empty or another one", () => {
	assert.equal(languageNeedsSync({ npmproLanguage: null }, "en"), true);
	assert.equal(languageNeedsSync({}, "de"), true);
	assert.equal(languageNeedsSync({ npmproLanguage: "fr" }, "de"), true);
});

it("does not sync when the stored language is the UI language", () => {
	assert.equal(languageNeedsSync({ npmproLanguage: "de" }, "de"), false);
});

it("sends once when the stored language differs, however often the user is passed", () => {
	const sent = [];
	const sync = createLanguageSync("de", async (language) => sent.push(language));
	sync({ npmproLanguage: "en" });
	sync({ npmproLanguage: "en" });
	sync({ npmproLanguage: null });
	assert.deepEqual(sent, ["de"]);
});

it("sends nothing when the languages are equal or before the user is loaded", () => {
	const sent = [];
	const sync = createLanguageSync("de", async (language) => sent.push(language));
	sync(undefined);
	sync({ npmproLanguage: "de" });
	assert.deepEqual(sent, []);
	sync({ npmproLanguage: "en" });
	assert.deepEqual(sent, ["de"]);
});

it("does not repeat a failed send and does not throw", async () => {
	let calls = 0;
	const sync = createLanguageSync("de", () => {
		calls += 1;
		return Promise.reject(new Error("HTTP 500"));
	});
	sync({ npmproLanguage: "en" });
	await new Promise((resolve) => setImmediate(resolve));
	sync({ npmproLanguage: "en" });
	assert.equal(calls, 1);
});

it("sends nothing for a user who never chose a language, so the default mail language applies", () => {
	const sent = [];
	const sync = createLanguageSync(null, async (language) => sent.push(language));
	sync({ npmproLanguage: null });
	sync({ npmproLanguage: "de" });
	assert.deepEqual(sent, []);
	assert.equal(languageNeedsSync({ npmproLanguage: null }, null), false);
	assert.equal(languageNeedsSync({ npmproLanguage: "fr" }, undefined), false);
});

it("sends an English the user chose", () => {
	const sent = [];
	createLanguageSync("en", async (language) => sent.push(language))({ npmproLanguage: null });
	assert.deepEqual(sent, ["en"]);
});
