import assert from "node:assert/strict";
import { it } from "node:test";
import { groupRows, pageGroups } from "./TableGroups.js";

const rows = [
	{ id: 1, g: "b" },
	{ id: 2, g: "" },
	{ id: 3, g: "a" },
	{ id: 4, g: "b" },
	{ id: 5, g: "a" },
];
const ids = (groups) => groups.map(([key, list]) => [key, list.map((row) => row.id)]);

it("orders the groups by name, rows without a group last, rows in their own order", () => {
	assert.deepEqual(ids(groupRows(rows, (row) => row.g)), [
		["a", [3, 5]],
		["b", [1, 4]],
		["", [2]],
	]);
});

it("cuts the rows of all groups into pages and keeps the groups of each page", () => {
	const groups = groupRows(rows, (row) => row.g);
	assert.deepEqual(ids(pageGroups(groups, 0, 3)), [
		["a", [3, 5]],
		["b", [1]],
	]);
	assert.deepEqual(ids(pageGroups(groups, 1, 3)), [
		["b", [4]],
		["", [2]],
	]);
	assert.deepEqual(pageGroups(groups, 2, 3), []);
});
