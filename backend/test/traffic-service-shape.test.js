import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { it } from "node:test";
import { promisify } from "node:util";
import { createTrafficService } from "../lib/traffic/service.js";

const run = promisify(execFile);

// the object service.js hands to its callers: a split of lib/traffic/service.js must keep it whole
const SERVICE_KEYS = [
	"deleteStats",
	"flush",
	"hostResolver",
	"maintain",
	"pause",
	"read",
	"recent",
	"resume",
	"setEnabled",
	"showIpsOff",
	"showIpsOn",
	"start",
	"status",
	"stop",
	"uniqueVisitorsOff",
	"uniqueVisitorsOn",
];

const FILES = ["host-list", "reader", "aggregator", "service"];

it("the traffic service has the same keys, all functions, and no timer before start", () => {
	const service = createTrafficService({
		store: {},
		geo: { available: () => ({}), lookup: () => null },
		getConfig: () => Promise.resolve({ values: {} }),
		loadState: () => Promise.resolve(null),
		saveState: () => Promise.resolve(),
		loadHosts: () => Promise.resolve([]),
		timers: {
			setInterval: () => assert.fail("no timer before start"),
			clearInterval: () => {},
			setTimeout: () => assert.fail("no timer before start"),
			clearTimeout: () => {},
		},
	});
	assert.deepEqual(Object.keys(service).sort(), SERVICE_KEYS);
	for (const key of SERVICE_KEYS) assert.equal(typeof service[key], "function", key);
	assert.deepEqual(service.status(), {
		enabled: false,
		skipped_lines: 0,
		dropped_requests: 0,
		last_read: null,
		error: null,
		visitors_error: null,
	});
});

for (const name of FILES) {
	it(`traffic/${name}.js loads first in a fresh process`, async () => {
		await run(process.execPath, ["--input-type=module", "-e", `await import("./lib/traffic/${name}.js")`]);
	});
}
