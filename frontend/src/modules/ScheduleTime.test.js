import assert from "node:assert/strict";
import { it } from "node:test";
import { nextRun, zoneOf } from "./ScheduleTime.js";

const ny = zoneOf("America/New_York");
const next = (schedule, after, zone = ny) => nextRun(schedule, new Date(after), zone).toISOString();

it("follows the backend rules in the server zone", () => {
	assert.equal(next({ frequency: "daily", time: "09:00" }, "2026-10-28T12:00:00Z"), "2026-10-28T13:00:00.000Z");
	assert.equal(
		next({ frequency: "weekly", weekday: 0, time: "09:00" }, "2026-10-28T12:00:00Z"),
		"2026-11-02T14:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "monthly", month_day: 28, time: "23:59" }, "2026-02-28T12:00:00Z"),
		"2026-03-01T04:59:00.000Z",
	);
	assert.equal(
		next({ frequency: "monthly", month_day: 1, time: "00:00" }, "2026-12-31T12:00:00Z"),
		"2027-01-01T05:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "hours", every_hours: 6, last_run_at: "2026-10-28T00:00:00Z" }, "2026-10-28T13:00:00Z"),
		"2026-10-28T18:00:00.000Z",
	);
});

it("handles the DST gap and the repeated hour like the backend", () => {
	assert.equal(next({ frequency: "daily", time: "02:30" }, "2026-03-07T12:00:00Z"), "2026-03-08T07:00:00.000Z");
	assert.equal(next({ frequency: "daily", time: "01:30" }, "2026-10-31T12:00:00Z"), "2026-11-01T05:30:00.000Z");
	assert.equal(next({ frequency: "daily", time: "01:30" }, "2026-11-01T05:30:00Z"), "2026-11-02T06:30:00.000Z");
});

it("zoneOf computes in the given zone, not the local one", () => {
	const tokyo = zoneOf("Asia/Tokyo");
	// 02:30 in Tokyo (no DST) on Mar 8 is Mar 7 17:30Z, whatever the zone this test runs in
	assert.equal(
		next({ frequency: "daily", time: "02:30" }, "2026-03-07T12:00:00Z", tokyo),
		"2026-03-07T17:30:00.000Z",
	);
});
