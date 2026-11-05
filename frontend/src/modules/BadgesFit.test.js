import assert from "node:assert/strict";
import { it } from "node:test";
import { fits } from "./BadgesFit.js";

it("fits when label, gap and badges add up to at most the row", () => {
	assert.equal(fits(100, 80, 8, 200), true);
	assert.equal(fits(100, 92, 8, 200), true);
});

it("does not fit when they add up to more than the row", () => {
	assert.equal(fits(100, 93, 8, 200), false);
	assert.equal(fits(300, 20, 8, 200), false);
});

it("does not fit before the row is measured or when a width is not a number", () => {
	assert.equal(fits(0, 0, 8, 0), false);
	assert.equal(fits(100, 50, 8, 0), false);
	assert.equal(fits(Number.NaN, 50, 8, 400), false);
	assert.equal(fits(100, undefined, 8, 400), false);
});
