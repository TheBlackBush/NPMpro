import assert from "node:assert/strict";
import { it } from "node:test";
import { SHADES, shadeIndex, shadeRanges } from "./MapShades.js";
import { mapScale } from "./Monitoring.js";

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

// the shade the map gives a country with this count when the busiest one has max (mapScale and shadeIndex, as
// WorldMapCanvas does)
const mapShade = (count, max) => {
	const scale = mapScale([
		{ country: "US", requests: max },
		{ country: "DE", requests: count },
	]);
	return shadeIndex(scale.DE);
};

it("has no ranges without data", () => {
	assert.deepEqual(shadeRanges(0), []);
	assert.deepEqual(shadeRanges(undefined), []);
});

it("gives a single count the top shade", () => {
	assert.deepEqual(shadeRanges(1), [{ shade: 5, from: 1, to: 1 }]);
});

it("skips the shades no count reaches", () => {
	// 1 is log1p(1) / log1p(2) = 0.63 of the scale, so shade 4; 2 is shade 5
	assert.deepEqual(shadeRanges(2), [
		{ shade: 4, from: 1, to: 1 },
		{ shade: 5, from: 2, to: 2 },
	]);
});

it("turns the shade edges back into count ranges", () => {
	assert.deepEqual(shadeRanges(103), [
		{ shade: 1, from: 1, to: 1 },
		{ shade: 2, from: 2, to: 5 },
		{ shade: 3, from: 6, to: 15 },
		{ shade: 4, from: 16, to: 40 },
		{ shade: 5, from: 41, to: 103 },
	]);
});

it("puts every count in the range of the shade the map gives it", () => {
	for (const max of [1, 2, 3, 5, 10, 31, 103, 1000, 1023]) {
		const ranges = shadeRanges(max);
		assert.equal(ranges.at(-1).to, max, `max ${max}`);
		for (let i = 1; i < ranges.length; i++) {
			assert.equal(ranges[i].from, ranges[i - 1].to + 1, `max ${max}: ranges follow each other`);
			assert.ok(ranges[i].shade > ranges[i - 1].shade, `max ${max}: shades go up`);
		}
		for (let count = 1; count <= max; count++) {
			const holding = ranges.filter((r) => r.from <= count && count <= r.to);
			assert.equal(holding.length, 1, `max ${max}, count ${count}: in one range`);
			assert.equal(holding[0].shade, mapShade(count, max), `max ${max}, count ${count}: shade`);
		}
	}
});
