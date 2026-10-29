import assert from "node:assert/strict";
import { it } from "node:test";
import {
	axisLabels,
	chartData,
	chartSeries,
	countryName,
	dataOffConfirm,
	errorRateColor,
	filterBans,
	filterRecent,
	formatBytes,
	formatCount,
	geoipSettingsPayload,
	hostEntryLabel,
	hostFilterFromSearch,
	hostFilterFromSelect,
	hostFilterToSearch,
	hostGroups,
	hostSelectValue,
	mapScale,
	monitoringSettingsPayload,
	OTHER_PATH,
	rangeOptions,
	relativeTimeParts,
	secondsLeftNow,
	shareBar,
	sparklinePoints,
	statusColor,
	timeLeftParts,
	trafficParams,
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

it("maps the host filter to the select value and back", () => {
	const cases = [
		[{}, ""],
		[{ host: "_other" }, "_other"],
		[{ hostType: "proxy", hostId: 12 }, "proxy:12"],
		[{ hostType: "dead", hostId: 3 }, "dead:3"],
		[{ host: "a.example.com" }, "key:a.example.com"],
	];
	for (const [filter, value] of cases) {
		assert.equal(hostSelectValue(filter), value);
		assert.deepEqual(hostFilterFromSelect(value), filter);
	}
	assert.equal(hostSelectValue({ hostType: "stream", hostId: 1 }), "");
	assert.equal(hostSelectValue(undefined), "");
	for (const bad of ["key:", "proxy:0", "proxy:x", "stream:1", undefined]) {
		assert.deepEqual(hostFilterFromSelect(bad), {});
	}
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

it("reads and writes the host filter in the URL", () => {
	const from = (q) => hostFilterFromSearch(new URLSearchParams(q));
	assert.deepEqual(from("host_type=proxy&host_id=12"), { hostType: "proxy", hostId: 12 });
	assert.deepEqual(from("host_type=dead&host_id=3&range=7d"), { hostType: "dead", hostId: 3 });
	assert.deepEqual(from("host=_other"), { host: "_other" });
	// old single form, read only
	assert.deepEqual(from("host=proxy:12"), { hostType: "proxy", hostId: 12 });
	// old plain key
	assert.deepEqual(from("host=a.example.com"), { host: "a.example.com" });
	assert.deepEqual(from("host=*.example.com"), { host: "*.example.com" });
	for (const bad of [
		"",
		"host=",
		"host_type=proxy",
		"host_id=3",
		"host_type=stream&host_id=1",
		"host_type=proxy&host_id=0",
		"host_type=proxy&host_id=x",
		"host_type=proxy&host_id=1.5",
	]) {
		assert.deepEqual(from(bad), {});
	}
	const base = new URLSearchParams("range=7d&host=proxy:1&host_type=dead&host_id=2");
	const written = hostFilterToSearch({ hostType: "redirection", hostId: 4 }, base);
	assert.equal(written.get("range"), "7d");
	assert.equal(written.get("host_type"), "redirection");
	assert.equal(written.get("host_id"), "4");
	assert.equal(written.has("host"), false);
	assert.equal(hostFilterToSearch({ host: "_other" }, base).toString(), "range=7d&host=_other");
	assert.equal(hostFilterToSearch({}, base).toString(), "range=7d");
	assert.equal(hostFilterToSearch({ hostType: "proxy", hostId: "x" }).toString(), "");
	assert.equal(hostFilterToSearch({ hostType: "stream", hostId: 1 }).toString(), "");
	const filter = { hostType: "dead", hostId: 9 };
	assert.deepEqual(hostFilterFromSearch(hostFilterToSearch(filter)), filter);
	assert.deepEqual(hostFilterFromSearch(hostFilterToSearch({ host: "_other" })), { host: "_other" });
});

it("builds the traffic query without mixing host and host_id", () => {
	assert.deepEqual(trafficParams("24h", {}), { range: "24h" });
	assert.deepEqual(trafficParams("7d", { host: "_other" }), { range: "7d", host: "_other" });
	assert.deepEqual(trafficParams("7d", "*.example.com"), { range: "7d", host: "*.example.com" });
	assert.deepEqual(trafficParams("1h", { hostType: "proxy", hostId: 12 }), {
		range: "1h",
		host_type: "proxy",
		host_id: 12,
	});
	assert.deepEqual(trafficParams("1h", { hostType: "proxy", hostId: 12, host: "x" }), {
		range: "1h",
		host_type: "proxy",
		host_id: 12,
	});
	assert.deepEqual(trafficParams("1h", { hostType: "stream", hostId: 12 }), { range: "1h" });
	assert.deepEqual(trafficParams("1h", { hostType: "proxy" }), { range: "1h" });
	assert.deepEqual(trafficParams("1h", { hostId: 3, host: "x" }), { range: "1h", host: "x" });
});

it("groups hosts for the host filter", () => {
	const groups = hostGroups({
		proxy: [
			{ id: 12, domainNames: ["a.example.com", "b.example.com", "c.example.com"] },
			{ id: 13, domainNames: [] },
		],
		redirection: undefined,
		dead: [{ id: 2, domainNames: ["x.example.com"] }],
	});
	assert.deepEqual(
		groups.map((g) => [g.type, g.labelKey, g.options.length]),
		[
			["proxy", "proxy-hosts", 1],
			["redirection", "redirection-hosts", 0],
			["dead", "dead-hosts", 1],
		],
	);
	assert.deepEqual(groups[0].options[0], {
		value: "proxy:12",
		hostType: "proxy",
		hostId: 12,
		label: "a.example.com",
		extra: 2,
		domainNames: ["a.example.com", "b.example.com", "c.example.com"],
	});
	assert.equal(groups[2].options[0].value, "dead:2");
	assert.equal(groups[2].options[0].extra, 0);
});

it("labels Top hosts entries", () => {
	assert.deepEqual(
		hostEntryLabel({ hostType: "proxy", name: "a.example.com", domainNames: ["a.example.com", "b.example.com"] }),
		{
			name: "a.example.com",
			extra: 1,
			badge: "proxy",
		},
	);
	assert.equal(
		hostEntryLabel({ hostType: "redirection", name: "r.example.com", domainNames: ["r.example.com"] }).badge,
		"redirection",
	);
	assert.equal(
		hostEntryLabel({ hostType: "dead", name: "d.example.com", domainNames: ["d.example.com"] }).badge,
		"dead",
	);
	assert.deepEqual(hostEntryLabel({ hostType: "deleted", name: "*.gone.com", domainNames: ["*.gone.com"] }), {
		name: "*.gone.com",
		extra: 0,
		badge: "deleted",
	});
	assert.deepEqual(hostEntryLabel({ hostType: "other", name: "_other", domainNames: [] }), {
		name: "_other",
		extra: 0,
		badge: null,
	});
});

it("falls back to the host id for an unnamed real host", () => {
	assert.equal(hostEntryLabel({ hostType: "proxy", hostId: 7, name: "", domainNames: [] }).name, "#7");
	assert.equal(hostEntryLabel({ hostType: "other", name: "", domainNames: [] }).name, "_other");
});

it("keeps the unique visitor keys in the monitoring settings payload and drops them when locked", () => {
	const values = { trafficEnabled: true, uniqueVisitors: true, visitorsCap: 5000, locked: [] };
	assert.deepEqual(monitoringSettingsPayload(values), {
		trafficEnabled: true,
		uniqueVisitors: true,
		visitorsCap: 5000,
	});
	assert.deepEqual(monitoringSettingsPayload({ ...values, locked: ["unique_visitors", "visitors_cap"] }), {
		trafficEnabled: true,
	});
});

it("never sends the visitor limit while unique visitors are off", () => {
	const values = { trafficEnabled: true, uniqueVisitors: false, visitorsCap: "", locked: [] };
	assert.deepEqual(monitoringSettingsPayload(values), { trafficEnabled: true, uniqueVisitors: false });
	assert.deepEqual(monitoringSettingsPayload({ ...values, uniqueVisitors: true, visitorsCap: 2000 }), {
		trafficEnabled: true,
		uniqueVisitors: true,
		visitorsCap: 2000,
	});
});

it("filterRecent searches host, method, path, status, country and IP", () => {
	const rows = [
		{ name: "app.example.com", method: "GET", path: "/login", status: 404, country: "DE", ip: "203.0.113.7" },
		{ name: "_other", method: "-", path: "", status: 400, country: null },
	];
	const options = {
		hostOf: (row) => (row.name === "_other" ? "Other hosts" : row.name),
		nameOf: (code) => countryName(code, "en"),
	};
	assert.equal(filterRecent(rows, "", options).length, 2);
	assert.deepEqual(filterRecent(rows, "APP.example", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "/log", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "get", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "GET /login", options), [rows[0]]);
	assert.deepEqual(filterRecent([rows[1]], "-", options), [], "the placeholder method is not searchable");
	assert.deepEqual(filterRecent(rows, "404", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "germany", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "203.0.113", options), [rows[0]]);
	assert.deepEqual(filterRecent(rows, "other hosts", options), [rows[1]]);
	assert.deepEqual(filterRecent(rows, "null", options), [], "a missing country or IP is not searchable text");
	assert.deepEqual(filterRecent(undefined, "x"), []);
});

it("statusColor follows the chart colours per status class", () => {
	assert.equal(statusColor(200), "green");
	assert.equal(statusColor(304), "blue");
	assert.equal(statusColor(499), "orange");
	assert.equal(statusColor(502), "red");
	assert.equal(statusColor(101), "secondary");
	assert.equal(statusColor(0), "secondary");
});

it("sends deleteStats only as true together with trafficEnabled false", () => {
	const off = { trafficEnabled: false, showIps: false, locked: [] };
	assert.deepEqual(monitoringSettingsPayload({ ...off, deleteStats: true }), {
		trafficEnabled: false,
		showIps: false,
		deleteStats: true,
	});
	assert.deepEqual(monitoringSettingsPayload({ ...off, deleteStats: false }), {
		trafficEnabled: false,
		showIps: false,
	});
	assert.deepEqual(monitoringSettingsPayload({ ...off, trafficEnabled: true, deleteStats: true }), {
		trafficEnabled: true,
		showIps: false,
	});
	// locked by TRAFFIC_STATS: trafficEnabled is not sent, so neither is deleteStats
	assert.deepEqual(monitoringSettingsPayload({ ...off, deleteStats: true, locked: ["traffic_enabled"] }), {
		showIps: false,
	});
});

it("gives the largest whole unit of a past time for Intl.RelativeTimeFormat", () => {
	const now = Date.UTC(2026, 9, 29, 12, 0, 0);
	const ago = (ms) => new Date(now - ms).toISOString();
	assert.deepEqual(relativeTimeParts(ago(20_000), now), { value: -20, unit: "second" });
	assert.deepEqual(relativeTimeParts(ago(59_400), now), { value: -59, unit: "second" });
	assert.deepEqual(relativeTimeParts(ago(150_000), now), { value: -2, unit: "minute" });
	assert.deepEqual(relativeTimeParts(ago(3 * 3_600_000 + 5), now), { value: -3, unit: "hour" });
	assert.deepEqual(relativeTimeParts(ago(49 * 3_600_000), now), { value: -2, unit: "day" });
	assert.deepEqual(relativeTimeParts(new Date(now).toISOString(), now), { value: 0, unit: "second" });
	assert.equal(relativeTimeParts("not a date", now), null);
});

it("shows a time ahead of the browser clock (clock skew) as now", () => {
	const now = Date.UTC(2026, 9, 29, 12, 0, 0);
	const ahead = (ms) => new Date(now + ms).toISOString();
	assert.deepEqual(relativeTimeParts(ahead(5_000), now), { value: 0, unit: "second" });
	assert.deepEqual(relativeTimeParts(ahead(2 * 3_600_000), now), { value: 0, unit: "second" });
});

it("builds one confirm dialog for the settings whose stored data is deleted", () => {
	assert.equal(dataOffConfirm({}), null);
	assert.deepEqual(dataOffConfirm({ pathsOff: true }), {
		items: ["missing-paths"],
		titleKey: "settings.monitoring.missing-paths.confirm",
		bodyKey: "settings.monitoring.missing-paths.confirm.body",
	});
	assert.deepEqual(dataOffConfirm({ ipsOff: true, visitorsOff: false }), {
		items: ["show-ips"],
		titleKey: "settings.monitoring.show-ips.confirm",
		bodyKey: "settings.monitoring.show-ips.confirm.body",
	});
	assert.deepEqual(dataOffConfirm({ ipsOff: true, visitorsOff: true, pathsOff: true }), {
		items: ["show-ips", "unique-visitors", "missing-paths"],
		titleKey: "settings.monitoring.data-off.confirm",
		bodyKey: "settings.monitoring.data-off.confirm.body",
	});
	assert.equal(OTHER_PATH, "(other)");
});

it("sends trafficMissingPaths unless it is locked", () => {
	const values = { trafficEnabled: true, trafficMissingPaths: true, uniqueVisitors: false, locked: [] };
	assert.deepEqual(monitoringSettingsPayload(values), {
		trafficEnabled: true,
		trafficMissingPaths: true,
		uniqueVisitors: false,
	});
	assert.deepEqual(monitoringSettingsPayload({ ...values, locked: ["traffic_missing_paths"] }), {
		trafficEnabled: true,
		uniqueVisitors: false,
	});
});
