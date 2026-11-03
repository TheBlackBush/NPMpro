import assert from "node:assert/strict";
import { it } from "node:test";
import { SHADES, shadeIndex, shadeRanges } from "./MapShades.js";

it("has five shades plus no data", () => {
	assert.equal(SHADES, 5);
	assert.equal(shadeIndex(undefined), 0);
	assert.equal(shadeIndex(0), 0);
});

it("splits the scale into five equal steps", () => {
	assert.equal(shadeIndex(0.01), 1);
	assert.equal(shadeIndex(0.2), 1);
	assert.equal(shadeIndex(0.21), 2);
	assert.equal(shadeIndex(0.6), 3);
	assert.equal(shadeIndex(0.8), 4);
	assert.equal(shadeIndex(0.81), 5);
	assert.equal(shadeIndex(1), 5);
});

it("turns the shade edges back into count ranges", () => {
	assert.deepEqual(shadeRanges(0), []);
	const ranges = shadeRanges(1000);
	assert.equal(ranges.length, 5);
	assert.equal(ranges[0].from, 1);
	assert.equal(ranges[4].to, 1000);
	for (let i = 1; i < 5; i++) assert.equal(ranges[i].from, ranges[i - 1].to + 1);
	assert.deepEqual(shadeRanges(1)[0], { from: 1, to: 1 });
});
