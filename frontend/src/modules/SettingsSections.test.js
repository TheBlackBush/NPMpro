import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";
import { groupSections, SETTINGS_CATEGORIES, SETTINGS_SECTIONS, settingsHelpDoc } from "./SettingsSections.js";

// a key of PARTS in sections.js: a section id and its icon
const PART = /^\t"?(?<id>[a-z-]+)"?: \{ icon:/gmu;
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

it("refuses a section without a known category, naming it", () => {
	assert.throws(() => groupSections([{ id: "new-section" }]), NAMES_SECTION);
	assert.throws(() => groupSections([{ id: "x", category: "other" }]), NAMES_CATEGORY);
});

it("gives every section one of the categories, in the menu's order, and sections.js its icon and page", () => {
	assert.deepEqual(
		groupSections(SETTINGS_SECTIONS).map(({ id, sections }) => [id, sections.map((section) => section.id)]),
		[
			["sites", ["default-site", "network", "nginx"]],
			["security", ["authentication", "forward-auth", "certificates"]],
			["monitoring", ["monitoring", "geoip"]],
			["data", ["backup", "database"]],
			["system", ["advanced", "environment"]],
		],
	);
	// the menu lists the sections category by category, so the list keeps that order too
	assert.deepEqual(
		SETTINGS_SECTIONS.map(({ id }) => id),
		groupSections(SETTINGS_SECTIONS).flatMap(({ sections }) => sections.map((section) => section.id)),
	);
	assert.equal(SETTINGS_CATEGORIES.length, 5);
	const source = readFileSync(new URL("../pages/Settings/sections.js", import.meta.url), "utf8");
	assert.deepEqual(
		[...source.matchAll(PART)].map(({ groups }) => groups.id),
		SETTINGS_SECTIONS.map(({ id }) => id),
	);
});

it("names a section's help document after its id", () => {
	assert.equal(settingsHelpDoc("default-site"), "SettingsDefaultSite");
	assert.equal(settingsHelpDoc("forward-auth"), "SettingsForwardAuth");
	assert.equal(settingsHelpDoc("geoip"), "SettingsGeoip");
});

it("has a help document in every language for every section", () => {
	const ids = SETTINGS_SECTIONS.map(({ id }) => id);
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
