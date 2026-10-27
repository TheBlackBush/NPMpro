import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIONS,
	byAction,
	changedChoices,
	chooseItems,
	emptyItemType,
	linkedItems,
	mergeCatalogue,
	mergeDefaults,
	needsChoice,
	requestItems,
	searchItems,
	sentChoices,
} from "./BackupMerge.js";

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

	it("needsChoice leaves out linked items, linkedItems returns them with or without a choice", () => {
		const withLinked = {
			items: [
				...plan.items,
				{ key: "certificates:1", linked: true, action: "existing", choices: ["existing", "add"] },
				{ key: "certificates:2", linked: true, action: "add", choices: ["add"] },
			],
		};
		assert.deepEqual(
			needsChoice(withLinked).map((item) => item.key),
			["proxy_hosts:1", "setting:oidc"],
		);
		assert.deepEqual(
			linkedItems(withLinked).map((item) => item.key),
			["certificates:1", "certificates:2"],
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

describe("BackupMerge item choice", () => {
	const first = {
		items: [
			{ key: "proxy_hosts:2", type: "proxy_hosts", id: 2, label: "b.test", linked: false },
			{ key: "proxy_hosts:1", type: "proxy_hosts", id: 1, label: "a.test", linked: false },
			{ key: "certificates:4", type: "certificates", id: 4, label: "a.test", linked: true },
			{ key: "setting:oidc", type: "settings_oidc", id: "oidc", label: "OIDC", linked: false },
		],
	};

	it("mergeCatalogue keeps the items chosen through their type, ordered by id", () => {
		assert.deepEqual(mergeCatalogue({}, first), {
			proxy_hosts: [
				{ id: 1, label: "a.test" },
				{ id: 2, label: "b.test" },
			],
		});
	});

	it("mergeCatalogue does not shrink when a later plan holds a subset", () => {
		const catalogue = mergeCatalogue({}, first);
		const later = { items: [{ key: "proxy_hosts:2", type: "proxy_hosts", id: 2, label: "b.test", linked: false }] };
		assert.deepEqual(mergeCatalogue(catalogue, later), catalogue);
	});

	it("requestItems sends only the subsets of selected types", () => {
		assert.deepEqual(requestItems({ proxy_hosts: [1], streams: [3] }, ["proxy_hosts"]), { proxy_hosts: [1] });
		assert.equal(requestItems({ streams: [3] }, ["proxy_hosts"]), undefined);
		assert.equal(requestItems({}, ["proxy_hosts"]), undefined);
	});

	it("chooseItems drops a type when all its items are chosen", () => {
		assert.deepEqual(chooseItems({}, "proxy_hosts", [1], 2), { proxy_hosts: [1] });
		assert.deepEqual(chooseItems({ proxy_hosts: [1] }, "proxy_hosts", [1, 2], 2), {});
		assert.deepEqual(chooseItems({}, "proxy_hosts", [], 2), { proxy_hosts: [] });
	});
});

describe("BackupMerge choices across plans", () => {
	const withApp = {
		items: [
			{
				key: "proxy_hosts:1",
				type: "proxy_hosts",
				action: "skip",
				choices: ["skip", "replace"],
				default: "skip",
			},
			{ key: "setting:3", type: "settings_runtime", action: "keep", choices: ["keep", "take"], default: "keep" },
		],
	};
	const withoutApp = { items: [withApp.items[1]] };

	it("keeps a choice whose item left the plan and comes back", () => {
		let defaults = mergeDefaults({}, withApp);
		const choices = { "proxy_hosts:1": "replace" };
		// the item is left out (unticked in Choose items or its type deselected), then chosen again
		defaults = mergeDefaults(defaults, withoutApp);
		assert.deepEqual(sentChoices(choices, defaults), { "proxy_hosts:1": "replace" });
		defaults = mergeDefaults(defaults, withApp);
		assert.deepEqual(sentChoices(choices, defaults), { "proxy_hosts:1": "replace" });
	});

	it("leaves out choices equal to their default", () => {
		const defaults = mergeDefaults({}, withApp);
		assert.deepEqual(sentChoices({ "proxy_hosts:1": "skip", "setting:3": "take" }, defaults), {
			"setting:3": "take",
		});
	});

	it("emptyItemType names a selected type with no item chosen", () => {
		assert.equal(emptyItemType({ proxy_hosts: [] }, ["proxy_hosts"]), "proxy_hosts");
		assert.equal(emptyItemType({ proxy_hosts: [] }, ["streams"]), null);
		assert.equal(emptyItemType({ proxy_hosts: [1] }, ["proxy_hosts"]), null);
	});
});
