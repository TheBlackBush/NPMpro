import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;

// the module reads the settings table, so the app runs under a test root first
before(async () => {
	api = await startApi();
});
after(() => api.stop());

it("logIgnoredGeoipEnv logs an invalid GEOIP_PROVIDER once, never a valid one", async () => {
	const { logIgnoredGeoipEnv } = await import("../lib/monitoring-config.js");
	const lines = [];
	const log = { warn: (line) => lines.push(line) };
	logIgnoredGeoipEnv({ ignored: [] }, log);
	assert.deepEqual(lines, []);
	logIgnoredGeoipEnv({ ignored: ["GEOIP_PROVIDER"] }, log);
	logIgnoredGeoipEnv({ ignored: ["GEOIP_PROVIDER"] }, log);
	assert.deepEqual(lines, ["GeoIP: GEOIP_PROVIDER must be dbip or maxmind, the value is ignored"]);
});
