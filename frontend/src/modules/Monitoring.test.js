import assert from "node:assert/strict";
import { it } from "node:test";
import {
	axisLabels,
	chartData,
	chartSeries,
	countryName,
	errorRateColor,
	filterBans,
	formatBytes,
	formatCount,
	geoipSettingsPayload,
	hostOptions,
	mapScale,
	monitoringSettingsPayload,
	rangeOptions,
	secondsLeftNow,
	shareBar,
	sparklinePoints,
	timeLeftParts,
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

it("turns API buckets into one chart series per status class", () => {
	const series = [
		{ bucket: 10, byClass: { "2xx": 5, "3xx": 0, "4xx": 1, "5xx": 0 } },
		{ bucket: 11, byClass: { "2xx": 2, "3xx": 1, "4xx": 0, "5xx": 3 } },
	];
	const minutes = chartSeries(series, "24h");
	assert.deepEqual(
		minutes.map((s) => s.key),
		["2xx", "3xx", "4xx", "5xx"],
	);
	assert.deepEqual(minutes[0].data, [
		[600_000, 5],
		[660_000, 2],
	]);
	assert.deepEqual(chartSeries(series, "7d")[3].data, [
		[36_000_000, 0],
		[39_600_000, 3],
	]);
	const withOther = chartSeries([{ bucket: 1, byClass: { "2xx": 1, other: 4 } }], "1h");
	assert.deepEqual(
		withOther.map((s) => [s.key, s.data[0][1]]),
		[
			["2xx", 1],
			["3xx", 0],
			["4xx", 0],
			["5xx", 0],
			["other", 4],
		],
	);
	assert.deepEqual(chartSeries(undefined, "1h")[0].data, []);
});

it("lists every managed domain name once, sorted, with _other last", () => {
	const proxy = [{ domainNames: ["B.example.com", "*.example.com"] }, { domainNames: ["a.example.com"] }];
	const redirection = [{ domainNames: ["a.example.com", " c.example.com "] }];
	assert.deepEqual(hostOptions([proxy, redirection, undefined]), [
		"*.example.com",
		"a.example.com",
		"b.example.com",
		"c.example.com",
		"_other",
	]);
	assert.deepEqual(hostOptions([[]], "gone.example.com"), ["gone.example.com", "_other"]);
	assert.deepEqual(hostOptions([[]], "_other"), ["_other"]);
});

it("names countries in the locale and keeps unknown codes", () => {
	assert.equal(countryName("de", "en"), "Germany");
	assert.equal(countryName("DE", "de"), "Deutschland");
	assert.equal(countryName("--", "en"), "--");
});

it("splits the time left of a ban into two units at most", () => {
	// short English rendering, as the en.json strings do it
	const short = (seconds) => {
		const parts = timeLeftParts(seconds);
		if (parts.length === 0) return "< 1m";
		return parts.map((p) => `${p.count}${p.unit[0]}`).join(" ");
	};
	assert.deepEqual(timeLeftParts(0), []);
	assert.deepEqual(timeLeftParts(59), []);
	assert.deepEqual(timeLeftParts(-5), []);
	assert.deepEqual(timeLeftParts(null), []);
	assert.deepEqual(timeLeftParts(14_342), [
		{ unit: "hours", count: 3 },
		{ unit: "minutes", count: 59 },
	]);
	assert.equal(short(60), "1m");
	assert.equal(short(3599), "59m");
	assert.equal(short(3600), "1h");
	assert.equal(short(14_342), "3h 59m");
	assert.equal(short(86_400), "1d");
	assert.equal(short(90_000), "1d 1h");
	assert.equal(short(604_799), "6d 23h");
	assert.equal(short(400 * 86_400), "400d");
});

it("counts the time left down from the fetch time", () => {
	const fetchedAt = "2026-10-24T12:00:00.000Z";
	const at = (s) => Date.parse(fetchedAt) + s * 1000;
	assert.equal(secondsLeftNow(600, fetchedAt, at(0)), 600);
	assert.equal(secondsLeftNow(600, fetchedAt, at(90.5)), 510);
	assert.equal(secondsLeftNow(600, fetchedAt, at(900)), 0);
	// a clock behind the server does not add time
	assert.equal(secondsLeftNow(600, fetchedAt, at(-30)), 600);
	assert.equal(secondsLeftNow(600, null, at(90)), 600);
	assert.equal(secondsLeftNow(undefined, fetchedAt, at(0)), 0);
});

it("filters bans by value, scenario, origin, type and country", () => {
	const rows = [
		{ value: "1.2.3.4", scenario: "crowdsecurity/ssh-bf", origin: "crowdsec", type: "ban", country: "DE" },
		{ value: "10.0.0.0/8", scenario: "manual", origin: "cscli", type: "captcha", country: null },
	];
	const nameOf = (code) => countryName(code, "en");
	assert.equal(filterBans(rows, "", nameOf).length, 2);
	assert.equal(filterBans(rows, "  ", nameOf).length, 2);
	assert.deepEqual(filterBans(rows, "1.2.3", nameOf), [rows[0]]);
	assert.deepEqual(filterBans(rows, "SSH", nameOf), [rows[0]]);
	assert.deepEqual(filterBans(rows, "cscli", nameOf), [rows[1]]);
	assert.deepEqual(filterBans(rows, "captcha", nameOf), [rows[1]]);
	assert.deepEqual(filterBans(rows, "germany", nameOf), [rows[0]]);
	assert.deepEqual(filterBans(rows, "de", nameOf), [rows[0]]);
	assert.deepEqual(filterBans(rows, "nothing", nameOf), []);
	assert.deepEqual(filterBans(undefined, "x"), []);
});

it("sparklinePoints scales values into the box", () => {
	const { line, area } = sparklinePoints([0, 5, 10], 100, 20, 2);
	assert.equal(line, "0,18 50,10 100,2");
	assert.equal(area, "0,20 0,18 50,10 100,2 100,20");
});

it("sparklinePoints draws a flat line for zeros and nothing for no data", () => {
	assert.equal(sparklinePoints([0, 0], 10, 10, 1).line, "0,9 10,9");
	assert.deepEqual(sparklinePoints([], 10, 10), { line: "", area: "" });
});

it("errorRateColor follows the 1 % and 5 % thresholds", () => {
	assert.equal(errorRateColor(0.0099), "secondary");
	assert.equal(errorRateColor(0.01), "orange");
	assert.equal(errorRateColor(0.05), "red");
});

it("splits the chart series into times, per-class values and totals", () => {
	const series = [
		{ bucket: 10, byClass: { "2xx": 5, "3xx": 1, "4xx": 2, "5xx": 0 } },
		{ bucket: 11, byClass: { "2xx": 2, "3xx": 1, "4xx": 0, "5xx": 3 } },
	];
	const data = chartData(chartSeries(series, "24h"));
	assert.deepEqual(data.times, [600_000, 660_000]);
	assert.deepEqual(data.values, [
		[5, 2],
		[1, 1],
		[2, 0],
		[0, 3],
	]);
	assert.deepEqual(data.totals, [7, 2, 2, 3]);
	const empty = chartData(chartSeries([], "1h"));
	assert.deepEqual(empty.times, []);
	assert.deepEqual(empty.values, [[], [], [], []]);
	assert.deepEqual(empty.totals, [0, 0, 0, 0]);
	assert.deepEqual(chartData(undefined), { times: [], values: [], totals: [] });
});

it("labels the time axis, naming each day once on the daily ranges", () => {
	const hour = 3_600_000;
	const day = (ms) => `d${Math.floor(ms / (24 * hour))}`;
	assert.deepEqual(
		axisLabels([0, 60_000], (ms) => `m${ms / 60_000}`),
		["m0", "m1"],
	);
	// starts 20:00: the partial first day has 4 hours, so it stays unnamed
	const late = [20, 21, 22, 23, 24, 25, 47, 48].map((h) => h * hour);
	assert.deepEqual(axisLabels(late, day, true), [null, null, null, null, "d1", null, null, "d2"]);
	// starts 06:00: 18 hours before the next day, so the first day is named
	const early = [6, 12, 24, 30].map((h) => h * hour);
	assert.deepEqual(axisLabels(early, day, true), ["d0", null, "d1", null]);
	assert.deepEqual(axisLabels([hour, 2 * hour], day, true), ["d0", null]);
	assert.deepEqual(axisLabels([], day, true), []);
	assert.deepEqual(axisLabels(undefined, day), []);
});
