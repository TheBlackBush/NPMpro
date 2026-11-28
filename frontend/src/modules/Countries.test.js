import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { it } from "node:test";
import { COUNTRY_CODES, countryName, isKnownCountry, searchCountries } from "./Countries.js";

it("holds the same codes in the same order as the backend", () => {
	const backend = JSON.parse(
		readFileSync(new URL("../../../backend/lib/country-codes.json", import.meta.url), "utf8"),
	);
	assert.deepEqual([...COUNTRY_CODES], backend);
	assert.equal(COUNTRY_CODES.length, 250);
});

it("has a flag file for every code", () => {
	const missing = COUNTRY_CODES.filter(
		(code) => !existsSync(new URL(`../../node_modules/country-flag-icons/string/3x2/${code}.js`, import.meta.url)),
	);
	assert.deepEqual(missing, []);
});

it("names a country in the UI language, the code when there is no name", () => {
	assert.equal(countryName("DE", "de"), "Deutschland");
	assert.equal(countryName("DE", "en"), "Germany");
	assert.equal(countryName("ZZ", "en"), "ZZ");
	assert.equal(countryName("not a code", "en"), "not a code");
});

it("knows the codes of the list only", () => {
	assert.equal(isKnownCountry("DE"), true);
	assert.equal(isKnownCountry("ZZ"), false);
});

it("searches by name in the language and by code, case and accent insensitive, sorted by name", () => {
	assert.ok(searchCountries("deu", "de").includes("DE"));
	assert.ok(searchCountries("fr", "en").includes("FR"));
	assert.ok(searchCountries("GERM", "en").includes("DE"));
	assert.ok(searchCountries("de", "en").includes("DE"));
	const accent = searchCountries("ä", "de");
	assert.deepEqual(
		accent,
		searchCountries("a", "de").filter((code) => accent.includes(code)),
	);
	assert.ok(accent.length > 0);
	assert.ok(searchCountries("cote", "fr").includes("CI"));
	assert.deepEqual(new Set(searchCountries("", "en")), new Set(COUNTRY_CODES));
	assert.equal(searchCountries("", "en").length, COUNTRY_CODES.length);
	const names = searchCountries("  ", "en").map((code) => countryName(code, "en"));
	assert.deepEqual(
		names,
		[...names].sort((a, b) => a.localeCompare(b, "en")),
	);
	assert.deepEqual(searchCountries("zzzz", "en"), []);
	assert.deepEqual(searchCountries("", "en", ["DE", "AT"]), ["AT", "DE"]);
});
