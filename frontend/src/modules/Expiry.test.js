import assert from "node:assert/strict";
import { it } from "node:test";
import { EXPIRY_WARNING_DAYS, expiryInfo } from "./Expiry.js";

const now = new Date("2026-10-23T12:00:00Z");
const days = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

it("uses a 14 day window", () => {
	assert.equal(EXPIRY_WARNING_DAYS, 14);
});

it("classifies the boundaries like the backend", () => {
	assert.deepEqual(expiryInfo(days(-1), now), { state: "expired", days: 0 });
	assert.deepEqual(expiryInfo(now.toISOString(), now), { state: "soon", days: 0 });
	assert.deepEqual(expiryInfo(days(1.5), now), { state: "soon", days: 1 });
	assert.deepEqual(expiryInfo(days(13.9), now), { state: "soon", days: 13 });
	assert.deepEqual(expiryInfo(days(14), now), { state: "ok", days: 14 });
	assert.deepEqual(expiryInfo(days(15), now), { state: "ok", days: 15 });
});
