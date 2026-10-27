import assert from "node:assert/strict";
import { it } from "node:test";
import { pageNumbers } from "./Pagination.js";

it("lists every page when there are few", () => {
	assert.deepEqual(pageNumbers(0, 3), [0, 1, 2]);
	assert.deepEqual(pageNumbers(4, 7), [0, 1, 2, 3, 4, 5, 6]);
});

it("collapses long ranges around the current page", () => {
	assert.deepEqual(pageNumbers(0, 10), [0, 1, null, 9]);
	assert.deepEqual(pageNumbers(5, 10), [0, null, 4, 5, 6, null, 9]);
	assert.deepEqual(pageNumbers(9, 10), [0, null, 8, 9]);
	assert.deepEqual(pageNumbers(2, 10), [0, 1, 2, 3, null, 9]);
});
