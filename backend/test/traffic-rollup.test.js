import assert from "node:assert/strict";
import { it } from "node:test";
import { cutoffs, errorRate, fillSeries, minutesToHours } from "../lib/traffic/rollup.js";

it("sums minute rows into hour rows", () => {
	const m = 29_401_020; // a unix minute, divisible by 60
	const rows = [
		{ bucket: m, host: "a", status_class: "2xx", requests: 2, bytes: 10 },
		{ bucket: m + 1, host: "a", status_class: "2xx", requests: 3, bytes: 5 },
		{ bucket: m, host: "a", status_class: "5xx", requests: 1, bytes: 1 },
	];
	const hour = Math.floor(m / 60);
	assert.deepEqual(
		minutesToHours(rows).sort((x, y) => x.status_class.localeCompare(y.status_class)),
		[
			{ bucket: hour, host: "a", status_class: "2xx", requests: 5, bytes: 15 },
			{ bucket: hour, host: "a", status_class: "5xx", requests: 1, bytes: 1 },
		],
	);
});

it("puts minutes on either side of an hour boundary into different hours", () => {
	const m = 29_401_020;
	const out = minutesToHours([
		{ bucket: m - 1, host: "a", status_class: "2xx", requests: 1, bytes: 1 },
		{ bucket: m, host: "a", status_class: "2xx", requests: 1, bytes: 1 },
	]);
	assert.deepEqual(out.map((r) => r.bucket).sort(), [m / 60 - 1, m / 60]);
});

it("computes cutoffs for 24 hours of minutes and the retention in hours", () => {
	const now = Date.UTC(2026, 9, 24, 12, 0, 0);
	assert.deepEqual(cutoffs({ now, retentionDays: 30 }), {
		minuteBefore: Math.floor(now / 60000) - 24 * 60,
		hourBefore: Math.floor(now / 3600000) - 30 * 24,
	});
});

it("fills missing buckets with zeros and sums classes", () => {
	const series = fillSeries(
		[
			{ bucket: 11, status_class: "2xx", requests: 2 },
			{ bucket: 11, status_class: "2xx", requests: 1 },
			{ bucket: 12, status_class: "5xx", requests: 4 },
			{ bucket: 99, status_class: "2xx", requests: 9 },
		],
		10,
		3,
	);
	assert.deepEqual(series, [
		{ bucket: 10, by_class: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } },
		{ bucket: 11, by_class: { "2xx": 3, "3xx": 0, "4xx": 0, "5xx": 0 } },
		{ bucket: 12, by_class: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 4 } },
	]);
});

it("computes the error rate as the 4xx and 5xx share", () => {
	assert.equal(
		errorRate([
			{ status_class: "2xx", requests: 6 },
			{ status_class: "4xx", requests: 1 },
			{ status_class: "5xx", requests: 1 },
		]),
		0.25,
	);
	assert.equal(errorRate([]), 0);
});
