import assert from "node:assert/strict";
import { it } from "node:test";
import { EXPIRY_WARNING_DAYS, expiryInfo } from "./Expiry.js";

const now = new Date("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const days = (n) => new Date(now.getTime() + n * DAY).toISOString();
// a certificate with the lifetime in days, expiring `left` days after now
const cert = (left, lifetime) => ({ expiresOn: days(left), validFrom: days(left - lifetime) });
const state = ({ expiresOn, validFrom }, options = {}) => expiryInfo(expiresOn, { validFrom, ...options }, now).state;

it("uses a 14 day window by default", () => {
	assert.equal(EXPIRY_WARNING_DAYS, 14);
});

it("classifies the boundaries without a valid-from date", () => {
	assert.deepEqual(expiryInfo(days(-1), {}, now), { state: "expired", days: 0 });
	assert.deepEqual(expiryInfo(now.toISOString(), { validFrom: null }, now), { state: "soon", days: 0 });
	assert.deepEqual(expiryInfo(days(1.5), undefined, now), { state: "soon", days: 1 });
	assert.deepEqual(expiryInfo(days(13.9), {}, now), { state: "soon", days: 13 });
	assert.deepEqual(expiryInfo(days(14), {}, now), { state: "ok", days: 14 });
	assert.deepEqual(expiryInfo(days(15), {}, now), { state: "ok", days: 15 });
});

it("warns 14 days before the end of a 90 day certificate", () => {
	assert.equal(state(cert(10, 90)), "soon");
	assert.equal(state(cert(20, 90)), "ok");
});

it("caps the window at a third of the lifetime", () => {
	// 6 day certificate: the window is 2 days
	assert.equal(state(cert(2.5, 6)), "ok");
	assert.equal(state(cert(1.9, 6)), "soon");
});

it("uses the days alone without a usable lifetime", () => {
	assert.equal(state({ expiresOn: days(5), validFrom: null }), "soon");
	assert.equal(state({ expiresOn: days(5), validFrom: null }, { days: 3 }), "ok");
	// a valid-from date at or after the expiry date is ignored
	assert.equal(state({ expiresOn: days(5), validFrom: days(5) }), "soon");
	assert.equal(state({ expiresOn: days(5), validFrom: days(9) }), "soon");
});

it("follows the warning days setting", () => {
	assert.equal(state(cert(25, 365), { days: 30 }), "soon");
	assert.equal(state(cert(10, 365), { days: 7 }), "ok");
	assert.equal(state(cert(5, 365), { days: 7 }), "soon");
});

it("treats a garbage date or a garbage valid-from date like the backend", () => {
	// a garbage expiry date is never soon or expired; a garbage valid-from date leaves the days alone
	assert.equal(expiryInfo("garbage", {}, now).state, "ok");
	assert.equal(state({ expiresOn: days(5), validFrom: "garbage" }), "soon");
	assert.equal(state({ expiresOn: days(5), validFrom: "garbage" }, { days: 3 }), "ok");
});

it("trusts the days it is given", () => {
	// the setting is 1 to 60 (the backend falls back to 14 for others; the health value is already checked)
	assert.equal(state({ expiresOn: days(5), validFrom: null }, { days: 1 }), "ok");
	assert.equal(state({ expiresOn: days(50), validFrom: null }, { days: 60 }), "soon");
	assert.equal(state({ expiresOn: days(0.5), validFrom: null }, { days: 0 }), "ok");
});
