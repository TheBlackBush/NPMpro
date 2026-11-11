import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitMercator, mercatorLat, mercatorY, tipPosition } from "./MapLayout.js";

describe("fitMercator", () => {
	it("fills 800 px less the margins with the whole world", () => {
		const fit = fitMercator(800);
		assert.equal(Math.round(fit.scale * 2 * Math.PI), 784);
		assert.equal(fit.height, 524);
		assert.equal(fit.center[0], 0);
		assert.ok(Math.abs(fit.center[1] - 44) < 0.5, `centre latitude ${fit.center[1]}`);
	});

	it("puts the north and south limits on the margins", () => {
		const fit = fitMercator(800, 8, 60, -60);
		// symmetric limits: centred on the equator, height from the limits
		assert.ok(Math.abs(fit.center[1]) < 1e-9);
		assert.equal(fit.height, Math.ceil(fit.scale * 2 * mercatorY(60) + 16));
	});
});

describe("mercator", () => {
	it("round-trips latitudes", () => {
		for (const lat of [-55.62, -10, 0, 44, 83.65]) {
			assert.ok(Math.abs(mercatorLat(mercatorY(lat)) - lat) < 1e-9);
		}
	});
});

describe("tipPosition", () => {
	it("follows the pointer in the middle of the box", () => {
		assert.deepEqual(tipPosition(300, 200, 800), { left: 300, top: 200, below: false });
	});

	it("keeps the tooltip inside the left and right edges", () => {
		assert.equal(tipPosition(5, 200, 800).left, 72);
		assert.equal(tipPosition(795, 200, 800).left, 728);
	});

	it("goes below the pointer near the top", () => {
		assert.equal(tipPosition(300, 20, 800).below, true);
	});

	it("stays at the edge margin in a box narrower than the tooltip", () => {
		assert.equal(tipPosition(50, 100, 100).left, 72);
	});
});
