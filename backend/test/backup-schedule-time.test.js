import assert from "node:assert/strict";
import { it } from "node:test";

// before any Date is made: the rules are checked in a zone with DST (2026: forward Mar 8, back Nov 1)
process.env.TZ = "America/New_York";
const { nextRun, wallTime, localZone } = await import("../lib/backup/schedule-time.js");

const at = (iso) => new Date(iso);
const next = (schedule, after) => nextRun(schedule, at(after)).toISOString();

it("every N hours counts from the last run, or from the save time", () => {
	const last = "2026-10-28T00:00:00.000Z";
	assert.equal(
		next({ frequency: "hours", every_hours: 6, last_run_at: last }, "2026-10-28T12:00:00Z"),
		"2026-10-28T18:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "hours", every_hours: 6, last_run_at: last }, "2026-10-28T13:00:00Z"),
		"2026-10-28T18:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "hours", every_hours: 24, last_run_at: last }, "2026-10-30T01:00:00Z"),
		"2026-10-31T00:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "hours", every_hours: 6, last_run_at: null }, "2026-10-28T12:00:00Z"),
		"2026-10-28T18:00:00.000Z",
	);
});

it("daily runs at the next time strictly after", () => {
	// 09:00 EDT is 13:00Z
	assert.equal(next({ frequency: "daily", time: "09:00" }, "2026-10-28T12:00:00Z"), "2026-10-28T13:00:00.000Z");
	assert.equal(next({ frequency: "daily", time: "09:00" }, "2026-10-28T13:00:00Z"), "2026-10-29T13:00:00.000Z");
});

it("weekly takes 0 as Monday", () => {
	// 2026-10-28 is a Wednesday; Monday Nov 2 09:00 is EST (14:00Z)
	assert.equal(
		next({ frequency: "weekly", weekday: 0, time: "09:00" }, "2026-10-28T12:00:00Z"),
		"2026-11-02T14:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "weekly", weekday: 2, time: "09:00" }, "2026-10-28T12:00:00Z"),
		"2026-10-28T13:00:00.000Z",
	);
	assert.equal(
		next({ frequency: "weekly", weekday: 6, time: "23:59" }, "2026-10-28T12:00:00Z"),
		"2026-11-02T04:59:00.000Z",
	);
});

it("monthly runs on day 28 in February and rolls over the year", () => {
	assert.equal(
		next({ frequency: "monthly", month_day: 28, time: "23:59" }, "2026-02-28T12:00:00Z"),
		"2026-03-01T04:59:00.000Z",
	);
	assert.equal(
		next({ frequency: "monthly", month_day: 28, time: "23:59" }, "2026-03-01T04:59:00Z"),
		"2026-03-29T03:59:00.000Z",
	);
	assert.equal(
		next({ frequency: "monthly", month_day: 1, time: "00:00" }, "2026-12-31T12:00:00Z"),
		"2027-01-01T05:00:00.000Z",
	);
});

it("a time in the spring-forward gap runs at the first minute after it", () => {
	// 02:30 does not exist on Mar 8; 03:00 EDT is 07:00Z
	assert.equal(next({ frequency: "daily", time: "02:30" }, "2026-03-07T12:00:00Z"), "2026-03-08T07:00:00.000Z");
	assert.equal(next({ frequency: "daily", time: "02:30" }, "2026-03-08T07:00:00Z"), "2026-03-09T06:30:00.000Z");
	assert.equal(wallTime(localZone, 2026, 2, 8, 2, 59).toISOString(), "2026-03-08T07:00:00.000Z");
});

it("a time that occurs twice runs once, at the first occurrence", () => {
	// 01:30 EDT (05:30Z) and 01:30 EST (06:30Z) on Nov 1
	assert.equal(next({ frequency: "daily", time: "01:30" }, "2026-10-31T12:00:00Z"), "2026-11-01T05:30:00.000Z");
	assert.equal(next({ frequency: "daily", time: "01:30" }, "2026-11-01T05:30:00Z"), "2026-11-02T06:30:00.000Z");
});
