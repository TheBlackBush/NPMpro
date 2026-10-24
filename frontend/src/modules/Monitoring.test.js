import assert from "node:assert/strict";
import { it } from "node:test";
import {
	formatBytes,
	formatCount,
	geoipSettingsPayload,
	mapScale,
	monitoringSettingsPayload,
	rangeOptions,
	shareBar,
} from "./Monitoring.js";

it("formats bytes with one decimal above 1 KB", () => {
	assert.equal(formatBytes(0), "0 B");
	assert.equal(formatBytes(1023), "1023 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(1.5 * 1024 * 1024), "1.5 MB");
	assert.equal(formatBytes(1024 ** 3), "1.0 GB");
	assert.equal(formatBytes(2.5 * 1024 ** 4), "2.5 TB");
	assert.equal(formatBytes(5000 * 1024 ** 4), "5000.0 TB");
	assert.equal(formatBytes(1024 * 1024 - 1), "1.0 MB");
	assert.equal(formatBytes(null), "0 B");
});

it("formats counts with k and M", () => {
	assert.equal(formatCount(0), "0");
	assert.equal(formatCount(999), "999");
	assert.equal(formatCount(1000), "1k");
	assert.equal(formatCount(1200), "1.2k");
	assert.equal(formatCount(3_400_000), "3.4M");
	assert.equal(formatCount(999_950), "1M");
	assert.equal(formatCount(2_500_000_000), "2.5B");
});

it("computes a share bar percentage", () => {
	assert.equal(shareBar(5, 10), 50);
	assert.equal(shareBar(10, 10), 100);
	assert.equal(shareBar(0, 10), 0);
	assert.equal(shareBar(5, 0), 0);
	assert.equal(shareBar(20, 10), 100);
});

it("scales countries on a log scale and skips unknown codes", () => {
	assert.deepEqual(mapScale([]), {});
	assert.deepEqual(mapScale(undefined), {});
	assert.deepEqual(mapScale([{ country: "DE", requests: 7 }]), { DE: 1 });
	const scale = mapScale([
		{ country: "DE", requests: 1000 },
		{ country: "fr", requests: 10 },
		{ country: "--", requests: 500 },
		{ country: null, requests: 500 },
		{ country: "US", requests: 0 },
	]);
	assert.deepEqual(Object.keys(scale).sort(), ["DE", "FR"]);
	assert.equal(scale.DE, 1);
	assert.ok(scale.FR > 0 && scale.FR < 1);
	assert.ok(Math.abs(scale.FR - Math.log1p(10) / Math.log1p(1000)) < 1e-12);
	assert.deepEqual(mapScale([{ country: "NL", count: 3 }]), { NL: 1 });
});

it("lists the four ranges with label keys", () => {
	assert.deepEqual(
		rangeOptions.map((o) => o.value),
		["1h", "24h", "7d", "30d"],
	);
	assert.ok(rangeOptions.every((o) => o.labelKey.startsWith("monitoring.range.")));
});

it("drops locked keys from the monitoring settings payload", () => {
	const values = {
		trafficEnabled: true,
		retentionDays: 30,
		showIps: false,
		locked: ["retention_days"],
	};
	assert.deepEqual(monitoringSettingsPayload(values), { trafficEnabled: true, showIps: false });
	assert.deepEqual(monitoringSettingsPayload({ ...values, locked: [] }), {
		trafficEnabled: true,
		retentionDays: 30,
		showIps: false,
	});
});

it("drops locked keys and an empty license key from the GeoIP payload", () => {
	const values = {
		accountId: "123",
		licenseKey: "",
		licenseKeySet: true,
		editions: ["GeoLite2-Country"],
		locked: ["account_id"],
		lastUpdate: null,
	};
	assert.deepEqual(geoipSettingsPayload(values), { editions: ["GeoLite2-Country"] });
	assert.deepEqual(geoipSettingsPayload({ ...values, licenseKey: "k", locked: [] }), {
		accountId: "123",
		licenseKey: "k",
		editions: ["GeoLite2-Country"],
	});
	assert.deepEqual(geoipSettingsPayload({ ...values, locked: ["license_key"], licenseKey: "k" }), {
		accountId: "123",
		editions: ["GeoLite2-Country"],
	});
});
