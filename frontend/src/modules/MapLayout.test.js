import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitMercator, mercatorLat, mercatorY } from "./MapLayout.js";

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
