import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, byAction, changedChoices, needsChoice, searchItems } from "./BackupMerge.js";

const plan = {
	items: [
		{ key: "proxy_hosts:1", label: "app.example.com", action: "add", choices: ["add", "skip"], default: "add" },
		{ key: "proxy_hosts:2", label: "b.test", action: "replace", choices: ["replace"], default: "replace" },
		{ key: "setting:oidc", label: "OIDC", action: "keep", choices: ["take", "keep"], default: "keep" },
		{ key: "proxy_hosts:3", label: "c.test", action: "add", choices: ["add"], default: "add" },
	],
};

describe("BackupMerge", () => {
	it("lists the actions in display order", () => {
		assert.deepEqual(ACTIONS, ["add", "replace", "take", "existing", "skip", "keep"]);
	});

	it("needsChoice returns only items with two or more choices", () => {
		assert.deepEqual(
			needsChoice(plan).map((item) => item.key),
			["proxy_hosts:1", "setting:oidc"],
		);
	});

	it("byAction groups in ACTIONS order and leaves out empty actions", () => {
		const groups = byAction(plan);
		assert.deepEqual(Object.keys(groups), ["add", "replace", "keep"]);
		assert.deepEqual(
			groups.add.map((item) => item.key),
			["proxy_hosts:1", "proxy_hosts:3"],
		);
	});

	it("changedChoices drops a choice equal to the default", () => {
		const choices = { "proxy_hosts:1": "skip", "proxy_hosts:2": "replace", "setting:oidc": "keep" };
		assert.deepEqual(changedChoices(plan, choices), { "proxy_hosts:1": "skip" });
		assert.deepEqual(changedChoices(plan, {}), {});
	});

	it("searchItems matches case-insensitively and returns all for empty text", () => {
		assert.deepEqual(
			searchItems(plan.items, "EXAMPLE").map((item) => item.key),
			["proxy_hosts:1"],
		);
		assert.equal(searchItems(plan.items, "").length, 4);
	});
});
