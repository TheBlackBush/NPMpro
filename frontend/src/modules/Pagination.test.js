import assert from "node:assert/strict";
import { it } from "node:test";
import { clampPage, pageCount, pageNumbers, pageRange, showPager } from "./Pagination.js";

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

it("counts pages", () => {
	assert.equal(pageCount(0, 25), 1);
	assert.equal(pageCount(25, 25), 1);
	assert.equal(pageCount(26, 25), 2);
	assert.equal(pageCount(101, 10), 11);
});

it("keeps a page index inside the pages that exist", () => {
	assert.equal(clampPage(3, 60, 25), 2);
	assert.equal(clampPage(1, 60, 25), 1);
	assert.equal(clampPage(5, 0, 25), 0);
	assert.equal(clampPage(-2, 60, 25), 0);
});

it("gives the first and last row of a page", () => {
	assert.deepEqual(pageRange(0, 25, 60), { from: 1, to: 25 });
	assert.deepEqual(pageRange(2, 25, 60), { from: 51, to: 60 });
	assert.deepEqual(pageRange(0, 25, 0), { from: 0, to: 0 });
});

it("shows the pager from 11 rows", () => {
	assert.equal(showPager(10), false);
	assert.equal(showPager(11), true);
});
