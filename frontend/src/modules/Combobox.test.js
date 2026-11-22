import assert from "node:assert/strict";
import { it } from "node:test";
import {
	appendEntries,
	canCreate,
	exactFirst,
	filterOptions,
	groupsOf,
	isEmptyValue,
	LINE_ENTRIES,
	orderKeys,
	partitionEntries,
	removeLast,
	splitEntries,
} from "./Combobox.js";

it("splits pasted lists on commas, spaces and new lines", () => {
	assert.deepEqual(splitEntries(" a.com, b.com\nc.com  d.com,,"), ["a.com", "b.com", "c.com", "d.com"]);
	assert.deepEqual(splitEntries("   "), []);
});

it("adds entries without duplicates, keeping order", () => {
	assert.deepEqual(appendEntries(["a.com"], splitEntries("B.com, a.com b.com")), ["a.com", "B.com"]);
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
	assert.deepEqual(appendEntries(["A"], splitEntries("a b"), { normalize: (v) => v }), ["A", "a", "b"]);
	assert.deepEqual(appendEntries(undefined, splitEntries("x")), ["x"]);
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

it("keeps spaces inside an entry in line mode, splitting on commas and new lines only", () => {
	assert.deepEqual(splitEntries("home lab, Prod\nedge  case", LINE_ENTRIES), ["home lab", "Prod", "edge  case"]);
	assert.deepEqual(appendEntries(["Prod"], splitEntries("prod, home lab", LINE_ENTRIES)), ["Prod", "home lab"]);
	assert.deepEqual(
		partitionEntries("ok tag, a/b", (entry) => !entry.includes("/"), LINE_ENTRIES),
		{
			accepted: ["ok tag"],
			rejected: ["a/b"],
		},
	);
	assert.deepEqual(appendEntries(["a"], ["b", "A", "c"]), ["a", "b", "c"]);
	// the default stays the word mode of the domain names
	assert.deepEqual(splitEntries("a.example.com b.example.com"), ["a.example.com", "b.example.com"]);
});

it("groupsOf keeps consecutive options of a group together", () => {
	const groups = groupsOf([{ groupLabel: "A" }, { groupLabel: "A" }, { groupLabel: "B" }, {}]);
	assert.deepEqual(
		groups.map((g) => g.label),
		["A", "B", null],
	);
	assert.deepEqual(
		groups.map((g) => g.items.length),
		[2, 1, 1],
	);
	assert.deepEqual(groupsOf([]), []);
});

it("createFirst lists Add first", () => {
	assert.deepEqual(orderKeys({ itemKeys: ["o:a"], createKey: "create:", createFirst: true }), ["create:", "o:a"]);
	assert.deepEqual(orderKeys({ itemKeys: ["o:a"], createKey: "create:" }), ["o:a", "create:"]);
	assert.deepEqual(orderKeys({ itemKeys: ["o:a"], createKey: null, createFirst: true }), ["o:a"]);
});

it("a fully typed name leads the list, never a suggestion that contains it", () => {
	const options = [{ value: "www.example.com" }, { value: "example.com" }, { value: "example.com.au" }];
	const label = (o) => o.value;
	// no "Add ..." is offered when an option is the text: that option must be the first (highlighted) one
	assert.equal(exactFirst(options, "Example.com", label, label)[0].value, "example.com");
	// with "Add ..." leading, Enter adds the typed name; without a match the order is kept
	assert.deepEqual(exactFirst(options, "exam", label, label), options);
	assert.deepEqual(exactFirst(options, "", label, label), options);
});

it("canCreate on the values refuses the ASCII form of a Unicode label", () => {
	const options = [{ label: "bücher.de", value: "xn--bcher-kva.de" }];
	assert.equal(
		canCreate("xn--bcher-kva.de", options, [], (o) => o.value),
		false,
	);
});
