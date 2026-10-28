import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIONS,
	byAction,
	changedChoices,
	choiceSummary,
	chooseItems,
	currentChoice,
	DECISION_ROWS,
	decisionItems,
	decisionReasons,
	emptyItemType,
	filterDecisions,
	focusLeavesPicker,
	groupChoices,
	groupDecisions,
	inSentence,
	isIncluded,
	linkedItems,
	mergeCatalogue,
	mergeDefaults,
	mouseLeavesPicker,
	needsChoice,
	pickerItems,
	requestItems,
	searchItems,
	sentChoices,
	setAllChoices,
	tickShown,
	typeNameId,
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

describe("BackupMerge decisions list", () => {
	const proxy = (id, extra = {}) => ({
		key: `proxy_hosts:${id}`,
		type: "proxy_hosts",
		id,
		label: `app-${id}.example.com`,
		action: "skip",
		reason: "domain-in-use",
		target: { type: "proxy_hosts", id: 100 + id, label: `app-${id}.example.com` },
		choices: ["skip", "replace"],
		default: "skip",
		linked: false,
		...extra,
	});
	const cert = {
		key: "certificates:4",
		type: "certificates",
		id: 4,
		label: "a.test",
		action: "existing",
		reason: "same-certificate",
		choices: ["existing", "add"],
		default: "existing",
		linked: true,
	};
	const plainAdd = {
		key: "streams:1",
		type: "streams",
		id: 1,
		label: "2222",
		action: "add",
		choices: [],
		reason: null,
	};
	const onlySkip = proxy(30, { choices: ["skip"], reason: "domain-in-use-several" });
	const setting = {
		key: "setting:1",
		type: "settings_default_site",
		id: 1,
		label: "Default site",
		action: "keep",
		reason: "differs",
		choices: ["keep", "take"],
		default: "keep",
		linked: false,
	};

	it("decisionItems lists matches, clashes and linked items, not plain adds", () => {
		const mixed = { items: [proxy(1), plainAdd, onlySkip, cert, setting] };
		assert.deepEqual(
			decisionItems(mixed).map((item) => item.key),
			["proxy_hosts:1", "proxy_hosts:30", "certificates:4", "setting:1"],
		);
	});

	it("currentChoice uses a local choice the item offers, else the plan's action", () => {
		assert.equal(currentChoice(proxy(1), "replace"), "replace");
		assert.equal(currentChoice(proxy(1), "take"), "skip");
		assert.equal(currentChoice(proxy(1), undefined), "skip");
		assert.equal(currentChoice(cert, "unticked"), "existing");
	});

	it("isIncluded follows a local untick, else the plan", () => {
		assert.equal(isIncluded(cert, undefined), true);
		assert.equal(isIncluded({ ...cert, unticked: true }, undefined), false);
		assert.equal(isIncluded(cert, "unticked"), false);
		assert.equal(isIncluded({ ...cert, unticked: true }, "add"), true);
	});

	it("filterDecisions narrows by search text and reason", () => {
		const items = [proxy(1), proxy(2), cert, setting];
		assert.deepEqual(
			filterDecisions(items, { search: "APP-2" }).map((item) => item.key),
			["proxy_hosts:2"],
		);
		assert.deepEqual(
			filterDecisions(items, { reason: "differs" }).map((item) => item.key),
			["setting:1"],
		);
		assert.equal(filterDecisions(items, {}).length, 4);
	});

	it("decisionReasons lists the reasons present in order", () => {
		assert.deepEqual(decisionReasons([proxy(1), cert, proxy(2), setting]), [
			"domain-in-use",
			"same-certificate",
			"differs",
		]);
	});

	it("groupDecisions groups by type in order and shows 8 rows of a group", () => {
		const items = [...Array.from({ length: 10 }, (_, index) => proxy(index + 1)), cert, setting];
		const groups = groupDecisions(items);
		assert.deepEqual(
			groups.map((group) => group.type),
			["proxy_hosts", "certificates", "settings_default_site"],
		);
		assert.equal(groups[0].items.length, 10);
		assert.equal(groups[0].rows.length, DECISION_ROWS);
		assert.equal(groups[0].more, 2);
		assert.equal(groups[1].rows.length, 1);
		assert.equal(groups[1].more, 0);
	});

	it("groupDecisions shows every row of an expanded group or while searching", () => {
		const items = Array.from({ length: 10 }, (_, index) => proxy(index + 1));
		assert.equal(groupDecisions(items, { expanded: ["proxy_hosts"] })[0].rows.length, 10);
		assert.equal(groupDecisions(items, { searching: true })[0].more, 0);
	});

	it("choiceSummary counts the current choice of each item over the group's choices", () => {
		const items = [proxy(1), proxy(2), proxy(3), onlySkip];
		assert.deepEqual(choiceSummary(items, { "proxy_hosts:2": "replace" }), [
			{ choice: "skip", count: 3 },
			{ choice: "replace", count: 1 },
		]);
	});

	it("groupChoices is the union of the group's choices in order", () => {
		assert.deepEqual(groupChoices([onlySkip, proxy(1)]), ["skip", "replace"]);
	});

	it("setAllChoices sets the shown items that offer the choice and are included", () => {
		const items = [proxy(1), proxy(2), onlySkip, cert];
		assert.deepEqual(setAllChoices(items, "replace", { "certificates:4": "unticked" }), {
			"proxy_hosts:1": "replace",
			"proxy_hosts:2": "replace",
		});
		assert.deepEqual(setAllChoices([cert], "add", {}), { "certificates:4": "add" });
		assert.deepEqual(setAllChoices([{ ...cert, unticked: true }], "add", {}), {});
	});
});

describe("BackupMerge item picker", () => {
	const items = [
		{ id: 1, label: "app.example.com" },
		{ id: 2, label: "shop.example.com" },
		{ id: 3, label: "api.example.com" },
		{ id: 4, label: "old.test" },
	];

	it("pickerItems filters by search and by selected only", () => {
		assert.deepEqual(
			pickerItems(items, [1, 2], { search: "example" }).map((item) => item.id),
			[1, 2, 3],
		);
		assert.deepEqual(
			pickerItems(items, ["2", 4], { selectedOnly: true }).map((item) => item.id),
			[2, 4],
		);
		assert.deepEqual(
			pickerItems(items, [2, 4], { search: "example", selectedOnly: true }).map((item) => item.id),
			[2],
		);
		assert.equal(pickerItems(items, [], {}).length, 4);
	});

	it("tickShown selects or clears only the shown items, in item order", () => {
		const shown = pickerItems(items, [], { search: "example" });
		assert.deepEqual(tickShown(items, [4], shown, true), [1, 2, 3, 4]);
		assert.deepEqual(tickShown(items, [1, 2, 4], shown, false), [4]);
		assert.deepEqual(tickShown(items, [3, 1], [], true), [1, 3]);
	});
});

describe("BackupMerge type names in a sentence", () => {
	it("inSentence lowercases the first letter in English, not acronyms or other languages", () => {
		assert.equal(inSentence("Proxy hosts", "en"), "proxy hosts");
		assert.equal(inSentence("DNS credentials", "en"), "DNS credentials");
		assert.equal(inSentence("404 hosts", "en"), "404 hosts");
		assert.equal(inSentence("Proxy-Hosts", "de"), "Proxy-Hosts");
		assert.equal(inSentence("", "en"), "");
	});
});

describe("BackupMerge type name by count", () => {
	const messages = {
		"settings.backup.type.proxy_hosts": "Proxy hosts",
		"settings.backup.type-one.proxy_hosts": "Proxy host",
		"settings.backup.type.settings_runtime": "Runtime settings",
	};

	it("typeNameId uses the singular name for one item when there is one", () => {
		assert.equal(typeNameId("proxy_hosts", 1, messages), "settings.backup.type-one.proxy_hosts");
		assert.equal(typeNameId("proxy_hosts", 2, messages), "settings.backup.type.proxy_hosts");
		assert.equal(typeNameId("settings_runtime", 1, messages), "settings.backup.type.settings_runtime");
		assert.equal(typeNameId("unknown", 1, messages), null);
	});
});

describe("BackupMerge item picker, outside", () => {
	// an element: its tag, classes and the elements it sits in
	const el = (tag, classes = [], parent = null) => {
		const node = { tagName: tag.toUpperCase(), classes, parent };
		node.matches = (selector) =>
			selector.split(",").some((part) => {
				const sel = part.trim();
				return sel.startsWith(".") ? classes.includes(sel.slice(1)) : sel.toUpperCase() === node.tagName;
			});
		node.contains = (inner) => {
			for (let at = inner; at; at = at.parent) if (at === node) return true;
			return false;
		};
		return node;
	};
	const html = el("html");
	const body = el("body", [], html);
	const modal = el("div", ["modal"], body);
	const dialog = el("div", ["modal-dialog"], modal);
	const content = el("div", ["modal-content"], dialog);
	const opener = el("button", ["btn"], content);
	const picker = el("div", ["dropdown-menu"], content);
	const search = el("input", [], picker);
	const label = el("label", ["dropdown-item"], picker);
	const other = el("button", ["btn"], content);

	it("focusLeavesPicker is true only for a focusable element outside the picker and its button", () => {
		assert.equal(focusLeavesPicker(other, picker, opener), true);
		assert.equal(focusLeavesPicker(search, picker, opener), false);
		assert.equal(focusLeavesPicker(opener, picker, opener), false);
	});

	it("focusLeavesPicker ignores the focus landing on the dialog's container, the dialog or the page", () => {
		// a click on a row's label text focuses the nearest focusable ancestor: the modal (tabindex -1)
		assert.equal(focusLeavesPicker(modal, picker, opener), false);
		assert.equal(focusLeavesPicker(dialog, picker, opener), false);
		assert.equal(focusLeavesPicker(body, picker, opener), false);
		assert.equal(focusLeavesPicker(html, picker, opener), false);
		assert.equal(focusLeavesPicker(null, picker, opener), false);
	});

	it("mouseLeavesPicker is true for a press anywhere outside the picker and its button", () => {
		assert.equal(mouseLeavesPicker(label, picker, opener), false);
		assert.equal(mouseLeavesPicker(opener, picker, opener), false);
		assert.equal(mouseLeavesPicker(other, picker, opener), true);
		assert.equal(mouseLeavesPicker(modal, picker, opener), true);
		assert.equal(mouseLeavesPicker(content, picker, null), true);
	});
});
