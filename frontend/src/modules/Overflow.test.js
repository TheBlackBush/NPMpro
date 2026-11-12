import assert from "node:assert/strict";
import { it } from "node:test";
import { isCut } from "./Overflow.js";

it("is cut when the content is wider than the box", () => {
	assert.equal(isCut({ scrollWidth: 201, clientWidth: 200 }), true);
});

it("is not cut when the content fits exactly or is narrower", () => {
	assert.equal(isCut({ scrollWidth: 200, clientWidth: 200 }), false);
	assert.equal(isCut({ scrollWidth: 120, clientWidth: 200 }), false);
});

it("is not cut without an element (not mounted yet)", () => {
	assert.equal(isCut(null), false);
	assert.equal(isCut(undefined), false);
});
