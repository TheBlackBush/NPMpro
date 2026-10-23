import assert from "node:assert/strict";
import { it } from "node:test";
import { cellLabel } from "./TableCells.js";

it("uses a string header as the stacked cell label", () => {
	assert.equal(cellLabel({ header: "Source" }), "Source");
});

it("gives no label for headers that are not plain strings", () => {
	assert.equal(cellLabel({ header: () => "x" }), undefined);
	assert.equal(cellLabel({ header: "" }), undefined);
	assert.equal(cellLabel({}), undefined);
	assert.equal(cellLabel(undefined), undefined);
});
