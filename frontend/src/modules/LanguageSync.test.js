import assert from "node:assert/strict";
import { it } from "node:test";
import { languageNeedsSync } from "./LanguageSync.js";

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
