import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_ITEM, fromItemValue, optionsFromElements, toItemValue } from "./SelectOptions.js";

describe("toItemValue", () => {
	it("keeps strings, turns numbers into strings", () => {
		assert.equal(toItemValue("https"), "https");
		assert.equal(toItemValue(301), "301");
		assert.equal(toItemValue(0), "0");
	});
	it("turns an empty value into the reserved item", () => {
		assert.equal(toItemValue(""), EMPTY_ITEM);
		assert.equal(toItemValue(null), EMPTY_ITEM);
		assert.equal(toItemValue(undefined), EMPTY_ITEM);
	});
});

describe("fromItemValue", () => {
	it("gives back strings, the empty value and numbers", () => {
		assert.equal(fromItemValue("~ "), "~ ");
		assert.equal(fromItemValue(EMPTY_ITEM), "");
		assert.equal(fromItemValue("302", { valueAsNumber: true }), 302);
		assert.equal(fromItemValue("0", { valueAsNumber: true }), 0);
	});
	it("round-trips every kind of value", () => {
		for (const value of ["", "allow", "$scheme", "= "]) assert.equal(fromItemValue(toItemValue(value)), value);
		for (const value of [0, 1, 307])
			assert.equal(fromItemValue(toItemValue(value), { valueAsNumber: true }), value);
	});
});

describe("optionsFromElements", () => {
	it("reads value and label from option elements, values as strings", () => {
		const elements = [
			{ type: "option", props: { value: 1, children: "PROXY v1" } },
			{ type: "option", props: { value: "", children: undefined } },
			"text",
			{ type: "div", props: { value: "x" } },
		];
		assert.deepEqual(optionsFromElements(elements), [
			{ value: "1", label: "PROXY v1" },
			{ value: "", label: undefined },
		]);
	});
});
