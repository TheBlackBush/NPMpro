import assert from "node:assert/strict";
import { it } from "node:test";
import { parsePreference, resolveTheme, startPreference, THEME_PREFERENCES } from "./Theme.js";

it("reads a stored theme choice, System for a missing or unknown value", () => {
	assert.deepEqual(THEME_PREFERENCES, ["light", "dark", "auto"]);
	for (const value of THEME_PREFERENCES) assert.equal(parsePreference(value), value);
	for (const value of [null, undefined, "", "system", "Dark", "blue"]) assert.equal(parsePreference(value), "auto");
});

it("starts on System once, then keeps the stored choice", () => {
	// before the one-time reset a stored light or dark was written by the first visit, not chosen
	assert.equal(startPreference("dark", null), "auto");
	assert.equal(startPreference("light", null), "auto");
	assert.equal(startPreference(null, null), "auto");
	assert.equal(startPreference("dark", "1"), "dark");
	assert.equal(startPreference("light", "1"), "light");
	assert.equal(startPreference("auto", "1"), "auto");
	assert.equal(startPreference("bogus", "1"), "auto");
});

it("shows the chosen theme, or the system's for System", () => {
	assert.equal(resolveTheme("light", true), "light");
	assert.equal(resolveTheme("dark", false), "dark");
	assert.equal(resolveTheme("auto", true), "dark");
	assert.equal(resolveTheme("auto", false), "light");
	assert.equal(resolveTheme("bogus", true), "dark");
});
