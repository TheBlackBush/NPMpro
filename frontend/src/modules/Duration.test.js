import assert from "node:assert/strict";
import { it } from "node:test";
import { formatElapsed } from "./Duration.js";

it("formats seconds as m:ss", () => {
	assert.equal(formatElapsed(0), "0:00");
	assert.equal(formatElapsed(7), "0:07");
	assert.equal(formatElapsed(65), "1:05");
	assert.equal(formatElapsed(600), "10:00");
});

it("tolerates bad input", () => {
	assert.equal(formatElapsed(-3), "0:00");
	assert.equal(formatElapsed(Number.NaN), "0:00");
	assert.equal(formatElapsed(59.9), "0:59");
});
