import assert from "node:assert/strict";
import { it } from "node:test";
import { selectedSectionId } from "./SettingsMenu.js";

const ids = ["default-site", "authentication", "backup"];

it("selects the section of the path", () => {
	assert.equal(selectedSectionId("/settings/backup", ids), "backup");
	assert.equal(selectedSectionId("/settings/authentication/", ids), "authentication");
});

it("accepts nested paths", () => {
	assert.equal(selectedSectionId("/settings/backup/restore", ids), "backup");
});

it("falls back to the first section", () => {
	assert.equal(selectedSectionId("/settings", ids), "default-site");
	assert.equal(selectedSectionId("/settings/nope", ids), "default-site");
	assert.equal(selectedSectionId("/users", ids), "default-site");
	assert.equal(selectedSectionId(undefined, ids), "default-site");
});
