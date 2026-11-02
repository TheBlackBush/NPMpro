import assert from "node:assert/strict";
import { it } from "node:test";
import { errorCountOf, firstErrorOf, tabErrorCounts, tabOfPath, tabsInMenu } from "./ModalTabs.js";

const error = (message = "Required") => ({ type: "validate", message });

const tabs = [
	{ id: "details", labelId: "column.details", fields: ["domainNames", "forwardHost", "fieldValues"] },
	{ id: "locations", labelId: "column.custom-locations", fields: ["locations"] },
	{ id: "tls", labelId: "column.ssl", fields: ["certificateId", "npmproDnsProvider"] },
	{ id: "advanced", labelId: "domains.advanced", fields: ["advancedConfig"], end: true },
];

it("finds the tab of a field, a nested field and a list row; none for a field of no tab", () => {
	assert.equal(tabOfPath(tabs, "forwardHost"), "details");
	assert.equal(tabOfPath(tabs, "fieldValues.token"), "details");
	assert.equal(tabOfPath(tabs, "locations[0].path"), "locations");
	assert.equal(tabOfPath(tabs, "locations.2.forwardHost"), "locations");
	assert.equal(tabOfPath(tabs, "npmproDnsProvider"), "tls");
	// a name that only starts like a field is another field
	assert.equal(tabOfPath(tabs, "forwardHostname"), null);
	assert.equal(tabOfPath(tabs, "accessRules"), null);
	assert.equal(tabOfPath([], "forwardHost"), null);
});

it("counts the shown errors of every tab, each field of a list row once, the root message nowhere", () => {
	const errors = {
		domainNames: error(),
		forwardHost: error("Invalid host"),
		locations: [undefined, { path: error(), forwardHost: error() }, { forwardPort: error() }],
		npmproDnsProvider: error(),
		accessRules: error("Add a rule"),
		root: { type: "server", message: "Failed" },
	};
	assert.deepEqual(tabErrorCounts(tabs, errors), { details: 2, locations: 3, tls: 1, advanced: 0 });
	assert.deepEqual(tabErrorCounts(tabs, {}), { details: 0, locations: 0, tls: 0, advanced: 0 });
});

it("adds up the errors of the tabs in the More menu", () => {
	const counts = { details: 2, locations: 3, tls: 1, advanced: 0 };
	assert.equal(errorCountOf(counts, ["tls", "advanced"]), 1);
	assert.equal(errorCountOf(counts, ["locations", "tls", "advanced"]), 4);
	assert.equal(errorCountOf(counts, []), 0);
	assert.equal(errorCountOf(counts, ["unknown"]), 0);
});

it("names the first error in field order and its tab, also when it sits in a later tab", () => {
	const order = ["domainNames", "forwardHost", "locations", "certificateId", "npmproDnsProvider", "advancedConfig"];
	const errors = { npmproDnsProvider: error(), locations: [{ path: error() }] };
	assert.deepEqual(firstErrorOf(errors, order, tabs), { path: "locations[0].path", tabId: "locations" });
	assert.deepEqual(firstErrorOf({ npmproDnsProvider: error() }, order, tabs), {
		path: "npmproDnsProvider",
		tabId: "tls",
	});
	// a message above the tabs comes after every field and opens no tab
	assert.deepEqual(firstErrorOf({ accessRules: error() }, order, tabs), { path: "accessRules", tabId: null });
	// a form without tabs
	assert.deepEqual(firstErrorOf({ forwardHost: error() }, order), { path: "forwardHost", tabId: null });
	assert.equal(firstErrorOf({}, order, tabs), null);
});

it("moves the tabs that do not fit into More, from the end, keeping room for More itself", () => {
	const row = [
		{ id: "details", width: 80 },
		{ id: "locations", width: 140 },
		{ id: "tls", width: 50 },
		{ id: "advanced", width: 90 },
	];
	// every tab fits (three gaps of 4): nothing moves, More does not show
	assert.deepEqual(tabsInMenu(row, 372, 70, 4), []);
	assert.deepEqual(tabsInMenu(row, 500, 70, 4), []);
	// one pixel short: More takes the room of the last tabs
	assert.deepEqual(tabsInMenu(row, 371, 70, 4), ["advanced"]);
	assert.deepEqual(tabsInMenu(row, 300, 70, 4), ["tls", "advanced"]);
	assert.deepEqual(tabsInMenu(row, 228, 70, 4), ["locations", "tls", "advanced"]);
	// not even the first tab fits next to More: everything is in More
	assert.deepEqual(tabsInMenu(row, 120, 70, 4), ["details", "locations", "tls", "advanced"]);
	// not measured yet (a hidden window): nothing moves
	assert.deepEqual(tabsInMenu(row, 0, 70, 4), []);
	assert.deepEqual(tabsInMenu([], 300, 70, 4), []);
});
