import assert from "node:assert/strict";
import { it } from "node:test";
import { mergeGeoipConfig, mergeMonitoringConfig } from "../lib/monitoring-rules.js";

it("monitoring defaults and env locks", () => {
	assert.deepEqual(mergeMonitoringConfig({}, {}).values, {
		traffic_enabled: false,
		retention_days: 30,
		show_ips: false,
		unique_visitors: false,
		visitors_cap: 100000,
	});
	// Write log files (LOGROTATE, also set by GOA) neither turns on nor locks traffic statistics
	for (const env of [{ LOGROTATE: "true" }, { LOGROTATE: "true", GOA: "true" }]) {
		const a = mergeMonitoringConfig({ traffic_enabled: false }, env);
		assert.equal(a.values.traffic_enabled, false);
		assert.deepEqual(a.locked, []);
		assert.equal(mergeMonitoringConfig({ traffic_enabled: true }, env).values.traffic_enabled, true);
	}
	assert.equal(mergeMonitoringConfig({}, { TRAFFIC_RETENTION_DAYS: "400" }).values.retention_days, 365);
	assert.equal(mergeMonitoringConfig({}, { TRAFFIC_RETENTION_DAYS: "3" }).values.retention_days, 7);
	assert.deepEqual(mergeMonitoringConfig({}, { TRAFFIC_RETENTION_DAYS: "x", TRAFFIC_SHOW_IPS: "" }).locked, []);
});

it("monitoring env switches lock on and off", () => {
	const on = mergeMonitoringConfig({}, { TRAFFIC_STATS: "true", TRAFFIC_SHOW_IPS: "true" });
	assert.equal(on.values.traffic_enabled, true);
	assert.equal(on.values.show_ips, true);
	assert.deepEqual(on.locked, ["traffic_enabled", "show_ips"]);
	const off = mergeMonitoringConfig({ traffic_enabled: true }, { TRAFFIC_STATS: "false" });
	assert.equal(off.values.traffic_enabled, false);
	assert.deepEqual(off.locked, ["traffic_enabled"]);
	const offWithLogs = mergeMonitoringConfig({ traffic_enabled: true }, { TRAFFIC_STATS: "false", LOGROTATE: "true" });
	assert.equal(offWithLogs.values.traffic_enabled, false);
	assert.deepEqual(offWithLogs.locked, ["traffic_enabled"]);
	assert.equal(mergeMonitoringConfig({ retention_days: 90, show_ips: null }, {}).values.retention_days, 90);
});

it("unique_visitors env lock", () => {
	assert.equal(mergeMonitoringConfig({}, {}).values.unique_visitors, false);
	const on = mergeMonitoringConfig({}, { TRAFFIC_UNIQUE_VISITORS: "true" });
	assert.equal(on.values.unique_visitors, true);
	assert.ok(on.locked.includes("unique_visitors"));
	const off = mergeMonitoringConfig({ unique_visitors: true }, { TRAFFIC_UNIQUE_VISITORS: "false" });
	assert.equal(off.values.unique_visitors, false);
	assert.ok(off.locked.includes("unique_visitors"));
	const empty = mergeMonitoringConfig({ unique_visitors: true }, { TRAFFIC_UNIQUE_VISITORS: "" });
	assert.equal(empty.values.unique_visitors, true);
	assert.deepEqual(empty.locked, []);
});

it("geoip editions from env, unknown ones dropped", () => {
	const g = mergeGeoipConfig({}, { GEOIP_EDITIONS: "GeoLite2-Country GeoLite2-City Bogus" });
	assert.deepEqual(g.values.editions, ["GeoLite2-Country", "GeoLite2-City"]);
	assert.deepEqual(g.locked, ["editions"]);
	assert.deepEqual(mergeGeoipConfig({}, {}).values.editions, ["GeoLite2-Country", "GeoLite2-ASN"]);
	assert.deepEqual(mergeGeoipConfig({}, { GEOIP_EDITIONS: "Bogus" }).locked, []);
});

it("geoip credentials from env lock and override", () => {
	const g = mergeGeoipConfig(
		{ account_id: "1", license_key: "stored" },
		{ GEOIP_ACCOUNT_ID: "42", GEOIP_LICENSE_KEY: "envkey", GEOIP_ACCOUNT_ID_X: "" },
	);
	assert.equal(g.values.account_id, "42");
	assert.equal(g.values.license_key, "envkey");
	assert.deepEqual(g.locked, ["account_id", "license_key"]);
	assert.equal(mergeGeoipConfig({}, { GEOIP_LICENSE_KEY: "" }).values.license_key, undefined);
});

it("visitors_cap env lock and range", () => {
	const set = mergeMonitoringConfig({ visitors_cap: 5000 }, { TRAFFIC_VISITORS_CAP: "20000" });
	assert.equal(set.values.visitors_cap, 20000);
	assert.ok(set.locked.includes("visitors_cap"));
	assert.equal(mergeMonitoringConfig({}, { TRAFFIC_VISITORS_CAP: "10" }).values.visitors_cap, 1000);
	assert.equal(mergeMonitoringConfig({}, { TRAFFIC_VISITORS_CAP: "99999999" }).values.visitors_cap, 1000000);
	const ignored = mergeMonitoringConfig({ visitors_cap: 5000 }, { TRAFFIC_VISITORS_CAP: "1e5" });
	assert.equal(ignored.values.visitors_cap, 5000);
	assert.deepEqual(ignored.locked, []);
	assert.equal(mergeMonitoringConfig({ visitors_cap: 12 }, {}).values.visitors_cap, 1000, "stored value clamped");
	assert.equal(mergeMonitoringConfig({ visitors_cap: "x" }, {}).values.visitors_cap, 100000);
});
