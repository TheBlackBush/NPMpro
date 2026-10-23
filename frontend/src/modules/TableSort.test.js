import assert from "node:assert/strict";
import { it } from "node:test";
import { ariaSort } from "./TableSort.js";

it("maps the table sort state to aria-sort", () => {
	assert.equal(ariaSort("asc"), "ascending");
	assert.equal(ariaSort("desc"), "descending");
	assert.equal(ariaSort(false), "none");
});
