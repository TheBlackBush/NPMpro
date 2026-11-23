import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	appendEntries,
	canCreate,
	commitTyped,
	createFirstActive,
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
import { domainSuggestions } from "./DomainSuggestions.js";

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

describe("createFirstActive", () => {
	const label = (o) => o.label;
	const value = (o) => o.value;
	const keyOf = (v) => `o:${v}`;
	const zones = [{ name: "example.com", credentialName: "main" }];
	const names = [{ name: "www.example.com", source: "proxy_host" }];
	// the keys and the highlight of a Domain Names field (filter false, createFirst) for a query
	const activeFor = ({ query, values = [], wildcards = true, isValid = () => true, offerCreate }) => {
		const items = exactFirst(
			domainSuggestions({ query, zones, names, values, wildcards, isValid }),
			query,
			label,
			value,
		);
		const createKey = offerCreate ? "create:" : null;
		const keys = orderKeys({ itemKeys: items.map((o) => keyOf(o.value)), createKey, createFirst: true });
		return {
			keys,
			active: createFirstActive({
				keys,
				createKey: "create:",
				items,
				query,
				getLabel: label,
				getValue: value,
				keyOf,
			}),
		};
	};

	it("highlights nothing for a name the field already holds", () => {
		const { keys, active } = activeFor({ query: "example.com", values: ["example.com"], offerCreate: false });
		// the list still offers other names (a wildcard, a used name), but Enter must not pick one
		assert.deepEqual(keys, ["o:*.example.com", "o:www.example.com"]);
		assert.equal(active, "");
	});

	it("highlights nothing for text the field refuses", () => {
		// a certificate window refuses a bare label such as "app"
		const { keys, active } = activeFor({
			query: "app",
			isValid: (name) => name.includes("."),
			offerCreate: false,
		});
		assert.ok(keys.includes("o:app.example.com"));
		assert.equal(active, "");
	});

	it("highlights the option that is exactly the typed text", () => {
		const { keys, active } = activeFor({ query: "WWW.example.com", offerCreate: false });
		assert.equal(keys[0], "o:www.example.com");
		assert.equal(active, "o:www.example.com");
	});

	it("highlights Add when it is offered", () => {
		const { keys, active } = activeFor({ query: "new.example.com", offerCreate: true });
		assert.equal(keys[0], "create:");
		assert.equal(active, "create:");
	});

	it("highlights nothing for an empty query or an exact option that is not listed", () => {
		const items = [{ label: "a.example.com", value: "a.example.com", disabled: true }];
		const base = { createKey: "create:", items, getLabel: label, getValue: value, keyOf };
		assert.equal(createFirstActive({ ...base, keys: [], query: "" }), "");
		assert.equal(createFirstActive({ ...base, keys: [], query: "a.example.com" }), "");
	});
});

it("commitTyped takes valid typed text, refuses the rest and ignores a field that cannot take it", () => {
	const valid = (text) => text.endsWith(".test");
	assert.deepEqual(commitTyped({ text: " a.test ", creatable: true, locked: false, isValidNew: valid }), {
		value: "a.test",
	});
	assert.deepEqual(commitTyped({ text: "nope", creatable: true, locked: false, isValidNew: valid }), {
		refused: ["nope"],
	});
	assert.deepEqual(commitTyped({ text: "x", creatable: true, locked: false }), { value: "x" });
	assert.equal(commitTyped({ text: "  ", creatable: true, locked: false }), null);
	assert.equal(commitTyped({ text: "a.test", creatable: false, locked: false }), null);
	assert.equal(commitTyped({ text: "a.test", creatable: true, locked: true }), null);
});
