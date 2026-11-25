import assert from "node:assert/strict";
import { after, it } from "node:test";
import { expiryState, warningDays, windowMs } from "../lib/expiry.js";
import { invalidate, prime } from "../lib/runtime-config.js";

const now = new Date("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const days = (n) => new Date(now.getTime() + n * DAY);
// a certificate with the lifetime in days, expiring `left` days after now
const cert = (left, lifetime) => ({ expires_on: days(left), npmpro_valid_from: days(left - lifetime) });
const setDays = (value) => prime("certificates", { values: { warning_days: value }, locked: [] });

after(() => invalidate("certificates"));

it("classifies the boundaries without a valid-from date", () => {
	const at = (n) => ({ expires_on: days(n), npmpro_valid_from: null });
	assert.equal(expiryState(at(-1), now), "expired");
	assert.equal(expiryState({ expires_on: new Date(now.getTime() - 1) }, now), "expired");
	assert.equal(expiryState(at(0), now), "soon");
	assert.equal(expiryState(at(13.9), now), "soon");
	assert.equal(expiryState(at(14), now), "ok");
	assert.equal(expiryState(at(15), now), "ok");
});

it("accepts database date strings", () => {
	assert.equal(expiryState({ expires_on: "2026-10-22 12:00:00" }, now), "expired");
	assert.equal(expiryState({ expires_on: "2026-10-30T12:00:00Z" }, now), "soon");
	assert.equal(
		expiryState(
			{ expires_on: "2026-10-30 12:00:00", npmpro_valid_from: "2026-10-01 12:00:00" },
			new Date("2026-10-23T12:00:00"),
		),
		"soon",
	);
});

it("warns 14 days before the end of a 90 day certificate", () => {
	assert.equal(expiryState(cert(10, 90), now), "soon");
	assert.equal(expiryState(cert(20, 90), now), "ok");
});

it("caps the window at a third of the lifetime", () => {
	// 6 day certificate: the window is 2 days
	assert.equal(expiryState(cert(2.5, 6), now), "ok");
	assert.equal(expiryState(cert(1.9, 6), now), "soon");
	assert.equal(windowMs({ expiresOn: days(6), validFrom: days(0) }), 2 * DAY);
});

it("uses the days alone without a usable lifetime", () => {
	assert.equal(windowMs({ expiresOn: days(5) }), 14 * DAY);
	assert.equal(windowMs({ expiresOn: days(5), validFrom: null }), 14 * DAY);
	// a valid-from date at or after the expiry date is ignored
	assert.equal(windowMs({ expiresOn: days(5), validFrom: days(5) }), 14 * DAY);
	assert.equal(windowMs({ expiresOn: days(5), validFrom: days(9) }), 14 * DAY);
	assert.equal(windowMs({ expiresOn: days(5), validFrom: null }, 3), 3 * DAY);
});

it("reads the warning days setting at call time", () => {
	invalidate("certificates");
	assert.equal(warningDays(), 14);
	setDays(30);
	assert.equal(warningDays(), 30);
	assert.equal(expiryState(cert(25, 365), now), "soon");
	setDays(7);
	assert.equal(expiryState(cert(10, 365), now), "ok");
	assert.equal(expiryState(cert(5, 365), now), "soon");
	setDays("bad");
	assert.equal(warningDays(), 14);
	invalidate("certificates");
});
