import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { alpha2Of, alpha2OfName } from "./CountryCodes.js";

const world = JSON.parse(readFileSync(new URL("../../node_modules/world-atlas/countries-110m.json", import.meta.url)));
const shapes = world.objects.countries.geometries;

it("maps ISO numeric codes to two-letter codes", () => {
	assert.equal(alpha2Of("276"), "DE");
	assert.equal(alpha2Of("840"), "US");
	assert.equal(alpha2Of("392"), "JP");
	assert.equal(alpha2Of("036"), "AU");
	assert.equal(alpha2Of("999"), null);
});

it("every world-atlas country with an ISO code has a two-letter code", () => {
	const missing = shapes.filter((g) => g.id && !alpha2Of(g.id)).map((g) => g.properties.name);
	assert.deepEqual(missing, []);
});

it("the shapes without an ISO code map by name where a code exists", () => {
	assert.equal(alpha2OfName("Kosovo"), "XK");
	assert.equal(alpha2OfName("N. Cyprus"), null);
	assert.equal(alpha2OfName("Somaliland"), null);
});
