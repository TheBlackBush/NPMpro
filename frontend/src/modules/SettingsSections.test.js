import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";
import { groupSections, SECTIONS_WITHOUT_HELP, SETTINGS_CATEGORIES, settingsHelpDoc } from "./SettingsSections.js";

// a section entry of sections.js: its id, then its category
const ENTRY = /\bid: "(?<id>[^"]+)",\s+category: "(?<category>[^"]+)"/gu;
const ID = /\bid: "/gu;
const NAMES_SECTION = /"new-section"/u;
const NAMES_CATEGORY = /"other"/u;

it("groups the sections by category in the categories' order, keeping each section's place", () => {
	const sections = [
		{ id: "geoip", category: "monitoring" },
		{ id: "default-site", category: "sites" },
		{ id: "network", category: "sites" },
		{ id: "environment", category: "system" },
	];
	assert.deepEqual(
		groupSections(sections).map(({ id, sections: list }) => [id, list.map((section) => section.id)]),
		[
			["sites", ["default-site", "network"]],
			["monitoring", ["geoip"]],
			["system", ["environment"]],
		],
	);
	assert.equal(groupSections(sections)[0].labelKey, "settings.category.sites");
});

it("puts the Administration sections last", () => {
	const sections = [
		{ id: "users", category: "administration" },
		{ id: "geoip", category: "monitoring" },
	];
	assert.deepEqual(
		groupSections(sections).map(({ id }) => id),
		["monitoring", "administration"],
	);
});

it("refuses a section without a known category, naming it", () => {
	assert.throws(() => groupSections([{ id: "new-section" }]), NAMES_SECTION);
	assert.throws(() => groupSections([{ id: "x", category: "other" }]), NAMES_CATEGORY);
});

it("gives every section in sections.js one of the categories, in the menu's order", () => {
	const source = readFileSync(new URL("../pages/Settings/sections.js", import.meta.url), "utf8");
	const entries = [...source.matchAll(ENTRY)].map(({ groups }) => groups);
	// every section entry has its category right after its id
	assert.equal(entries.length, [...source.matchAll(ID)].length);
	assert.deepEqual(
		groupSections(entries).map(({ id, sections }) => [id, sections.map((section) => section.id)]),
		[
			["sites", ["default-site", "network", "nginx"]],
			["security", ["authentication", "forward-auth", "certificates"]],
			["monitoring", ["monitoring", "geoip"]],
			["data", ["backup", "database"]],
			["system", ["advanced", "environment"]],
			["administration", ["users", "audit-log"]],
		],
	);
	// the menu lists the sections category by category, so sections.js keeps that order too
	assert.deepEqual(
		entries.map(({ id }) => id),
		groupSections(entries).flatMap(({ sections }) => sections.map((section) => section.id)),
	);
	assert.equal(SETTINGS_CATEGORIES.length, 6);
	assert.equal(SETTINGS_CATEGORIES.at(-1).id, "administration");
	assert.equal(SETTINGS_CATEGORIES.at(-1).labelKey, "settings.category.administration");
});

it("names a section's help document after its id", () => {
	assert.equal(settingsHelpDoc("default-site"), "SettingsDefaultSite");
	assert.equal(settingsHelpDoc("forward-auth"), "SettingsForwardAuth");
	assert.equal(settingsHelpDoc("geoip"), "SettingsGeoip");
});

it("has a help document in every language for every section in sections.js", () => {
	const source = readFileSync(new URL("../pages/Settings/sections.js", import.meta.url), "utf8");
	const ids = [...source.matchAll(ENTRY)]
		.map(({ groups }) => groups.id)
		.filter((id) => !SECTIONS_WITHOUT_HELP.includes(id));
	assert.ok(ids.length > 10);
	const help = new URL("../../translations/help/", import.meta.url);
	const languages = readdirSync(help, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name);
	assert.ok(languages.includes("en"));
	const missing = languages.flatMap((language) =>
		ids.map((id) => `${language}/${settingsHelpDoc(id)}.md`).filter((path) => !existsSync(new URL(path, help))),
	);
	assert.deepEqual(missing, []);
});
