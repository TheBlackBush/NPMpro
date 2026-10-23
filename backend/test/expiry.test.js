import assert from "node:assert/strict";
import { it } from "node:test";
import { EXPIRY_WARNING_DAYS, expiryBounds, expiryState } from "../lib/expiry.js";

const now = new Date("2026-10-23T12:00:00Z");
const days = (n) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

it("uses a 14 day window", () => {
	assert.equal(EXPIRY_WARNING_DAYS, 14);
});

it("classifies the boundaries", () => {
	assert.equal(expiryState(days(-1), now), "expired");
	assert.equal(expiryState(new Date(now.getTime() - 1), now), "expired");
	assert.equal(expiryState(now, now), "soon");
	assert.equal(expiryState(days(13.9), now), "soon");
	assert.equal(expiryState(days(14), now), "ok");
	assert.equal(expiryState(days(15), now), "ok");
});

it("accepts database date strings", () => {
	assert.equal(expiryState("2026-10-22 12:00:00", now), "expired");
	assert.equal(expiryState("2026-10-30T12:00:00Z", now), "soon");
});

it("returns the query bounds", () => {
	const { now: n, soon } = expiryBounds(now);
	assert.equal(n.getTime(), now.getTime());
	assert.equal(soon.getTime(), days(14).getTime());
});
