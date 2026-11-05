import assert from "node:assert/strict";
import { it } from "node:test";
import {
	addEntries,
	canCreate,
	filterOptions,
	isEmptyValue,
	partitionEntries,
	removeLast,
	splitEntries,
} from "./Combobox.js";

it("splits pasted lists on commas, spaces and new lines", () => {
	assert.deepEqual(splitEntries(" a.com, b.com\nc.com  d.com,,"), ["a.com", "b.com", "c.com", "d.com"]);
	assert.deepEqual(splitEntries("   "), []);
});

it("adds entries without duplicates, keeping order", () => {
	assert.deepEqual(addEntries(["a.com"], "B.com, a.com b.com"), ["a.com", "B.com"]);
});

it("removes the last entry", () => {
	assert.deepEqual(removeLast(["a", "b"]), ["a"]);
	assert.deepEqual(removeLast([]), []);
});

it("filters options case-insensitively by label", () => {
	const options = [
		{ value: 1, label: "Office" },
		{ value: 2, label: "Admins" },
	];
	assert.deepEqual(
		filterOptions(options, "off", (o) => o.label).map((o) => o.value),
		[1],
	);
	assert.equal(filterOptions(options, "", (o) => o.label).length, 2);
});

it("offers to create only a new, non-empty value", () => {
	const options = [{ value: "home", label: "Home" }];
	assert.equal(
		canCreate("media", options, [], (o) => o.label),
		true,
	);
	assert.equal(
		canCreate("HOME", options, [], (o) => o.label),
		false,
	);
	assert.equal(
		canCreate("x", options, ["x"], (o) => o.label),
		false,
	);
	assert.equal(
		canCreate("  ", options, [], (o) => o.label),
		false,
	);
});

it("adds entries with a caller's normalize", () => {
	assert.deepEqual(addEntries(["A"], "a b", { normalize: (v) => v }), ["A", "a", "b"]);
	assert.deepEqual(addEntries(undefined, "x"), ["x"]);
});

it("parts typed entries into the ones a field accepts and the ones it keeps as text", () => {
	const isValid = (entry) => entry.includes(".");
	assert.deepEqual(partitionEntries("a.com bad, b.com", isValid), {
		accepted: ["a.com", "b.com"],
		rejected: ["bad"],
	});
	assert.deepEqual(partitionEntries("a b"), { accepted: ["a", "b"], rejected: [] });
});

it("treats null, undefined and an empty string as no value", () => {
	assert.equal(isEmptyValue(null), true);
	assert.equal(isEmptyValue(undefined), true);
	assert.equal(isEmptyValue(""), true);
	assert.equal(isEmptyValue(0), false);
	assert.equal(isEmptyValue("x"), false);
});
