import assert from "node:assert/strict";
import { it } from "node:test";
import { menuLayout } from "./MenuLayout.js";

it("uses the phone menu below 1024 px", () => {
	for (const width of [390, 768, 820, 1023]) assert.equal(menuLayout(width), "phone", String(width));
});

it("shows the compact row (labels without icons, tighter padding) from 1024 to 1279 px", () => {
	for (const width of [1024, 1180, 1279]) assert.equal(menuLayout(width), "row-compact", String(width));
});

it("shows the full row with icons from 1280 px", () => {
	for (const width of [1280, 1440, 2560]) assert.equal(menuLayout(width), "row", String(width));
});
