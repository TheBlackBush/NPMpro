const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/**
 * 0 -> "0 B", 1023 -> "1023 B", 1024 -> "1.0 KB", 1.5 MB -> "1.5 MB". One decimal above bytes, TB is the top unit.
 */
const formatBytes = (n) => {
	let value = Number(n);
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	if (unit === 0) return `${Math.round(value)} B`;
	// 1023.96 KB would print as 1024.0 KB: move up a unit instead
	if (value.toFixed(1) === "1024.0" && unit < BYTE_UNITS.length - 1) {
		return `1.0 ${BYTE_UNITS[unit + 1]}`;
	}
	return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
};

const TRAILING_ZERO = /\.0$/u;
const COUNTRY_CODE = /^[A-Za-z]{2}$/u;

const COUNT_UNITS = [
	{ size: 1e9, suffix: "B" },
	{ size: 1e6, suffix: "M" },
	{ size: 1e3, suffix: "k" },
];

const shortNumber = (value, size, suffix) => `${(value / size).toFixed(1).replace(TRAILING_ZERO, "")}${suffix}`;

/**
 * 999 -> "999", 1200 -> "1.2k", 3.4M -> "3.4M". A trailing ".0" is dropped.
 */
const formatCount = (n) => {
	const value = Math.round(Number(n));
	if (!Number.isFinite(value) || value <= 0) return "0";
	if (value < 1000) return String(value);
	for (let i = 0; i < COUNT_UNITS.length; i++) {
		const { size, suffix } = COUNT_UNITS[i];
		if (value >= size) {
			const text = shortNumber(value, size, suffix);
			// 999950 would print as 1000k: use the next unit up
			if (text.startsWith("1000") && i > 0) {
				const up = COUNT_UNITS[i - 1];
				return shortNumber(value, up.size, up.suffix);
			}
			return text;
		}
	}
	return String(value);
};

/**
 * Width of a share bar in percent (0..100). A max of 0 (or less) gives 0.
 */
const shareBar = (value, max) => {
	const v = Number(value);
	const m = Number(max);
	if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0 || v <= 0) return 0;
	return Math.min(100, (v / m) * 100);
};

const isCountryCode = (code) => typeof code === "string" && COUNTRY_CODE.test(code);

/**
 * Log scale colour intensity per country, for the map.
 * countries: [{ country, requests }] (traffic) or [{ country, count }] (CrowdSec). Returns { [CODE]: 0..1 }.
 * Unknown codes ("--", null, anything but two letters) are skipped.
 */
const mapScale = (countries) => {
	const values = {};
	for (const item of countries ?? []) {
		const amount = Number(item?.requests ?? item?.count ?? 0);
		if (isCountryCode(item?.country) && amount > 0) {
			const code = item.country.toUpperCase();
			values[code] = (values[code] ?? 0) + amount;
		}
	}
	const max = Math.max(0, ...Object.values(values));
	const scale = {};
	for (const [code, amount] of Object.entries(values)) {
		scale[code] = Math.log1p(amount) / Math.log1p(max);
	}
	return scale;
};

const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"];
const BUCKET_MS = { "1h": 60_000, "24h": 60_000, "7d": 3_600_000, "30d": 3_600_000 };

/**
 * API series ([{ bucket, byClass }]) to one chart series per status class, as [timestamp in ms, requests] points.
 * 2xx to 5xx always, "other" only when a bucket has it. Buckets are unix minutes for 1h and 24h, unix hours otherwise.
 */
const chartSeries = (series, range) => {
	const size = BUCKET_MS[range] ?? BUCKET_MS["24h"];
	const rows = series ?? [];
	const classes = rows.some((row) => row?.byClass?.other !== undefined)
		? [...STATUS_CLASSES, "other"]
		: STATUS_CLASSES;
	return classes.map((key) => ({
		key,
		data: rows.map((row) => [Number(row.bucket) * size, Number(row?.byClass?.[key] ?? 0)]),
	}));
};

const OTHER_HOST = "_other";

/**
 * Host filter options from the host lists (proxy, redirection, 404): every domain name once, lower case, sorted,
 * then the "_other" key. A current value that is not in the lists is kept, so a filter from the URL stays selectable.
 */
const hostOptions = (lists, current = "") => {
	const names = new Set();
	for (const list of lists) {
		for (const host of list ?? []) {
			for (const name of host?.domainNames ?? []) {
				const value = String(name).trim().toLowerCase();
				if (value !== "") names.add(value);
			}
		}
	}
	if (current && current !== OTHER_HOST) names.add(current);
	names.delete(OTHER_HOST);
	return [...[...names].sort((a, b) => a.localeCompare(b)), OTHER_HOST];
};

/**
 * Country name in the given locale, the code itself when the runtime does not know it.
 */
const countryName = (code, locale) => {
	if (!isCountryCode(code)) return String(code ?? "");
	const upper = code.toUpperCase();
	try {
		return new Intl.DisplayNames([locale, "en"], { type: "region" }).of(upper) ?? upper;
	} catch {
		return upper;
	}
};

/**
 * Time left of a CrowdSec decision as up to two units, for the UI to translate:
 * 14342 -> [{ unit: "hours", count: 3 }, { unit: "minutes", count: 59 }], 604799 -> days 6, hours 23.
 * A zero second unit is left out (7200 -> hours 2 only). Below a minute (or not a number) gives [].
 */
const timeLeftParts = (seconds) => {
	const s = Math.floor(Number(seconds));
	if (!Number.isFinite(s) || s < 60) return [];
	const days = Math.floor(s / 86_400);
	const hours = Math.floor((s % 86_400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const pair = (bigUnit, big, smallUnit, small) =>
		small > 0
			? [
					{ unit: bigUnit, count: big },
					{ unit: smallUnit, count: small },
				]
			: [{ unit: bigUnit, count: big }];
	if (days > 0) return pair("days", days, "hours", hours);
	if (hours > 0) return pair("hours", hours, "minutes", minutes);
	return [{ unit: "minutes", count: minutes }];
};

/**
 * Seconds left now for a decision that had `secondsLeft` at `fetchedAt` (ISO time), never below 0.
 * Without a usable fetchedAt the reported value is returned unchanged.
 */
const secondsLeftNow = (secondsLeft, fetchedAt, now = Date.now()) => {
	const left = Math.max(0, Number(secondsLeft) || 0);
	const fetched = Date.parse(fetchedAt ?? "");
	if (!Number.isFinite(fetched)) return left;
	return Math.max(0, left - Math.max(0, Math.floor((now - fetched) / 1000)));
};

/**
 * Bans whose value, scenario, origin, type, country code or country name contain the search text (case-insensitive).
 * `nameOf(code)` gives the shown country name; an empty search keeps every row.
 */
const filterBans = (rows, q, nameOf = () => "") => {
	const needle = String(q ?? "")
		.trim()
		.toLowerCase();
	if (needle === "") return rows ?? [];
	return (rows ?? []).filter((row) =>
		[row.value, row.scenario, row.origin, row.type, row.country, row.country ? nameOf(row.country) : ""]
			.join(" ")
			.toLowerCase()
			.includes(needle),
	);
};

const rangeOptions = [
	{ value: "1h", labelKey: "monitoring.range.1h" },
	{ value: "24h", labelKey: "monitoring.range.24h" },
	{ value: "7d", labelKey: "monitoring.range.7d" },
	{ value: "30d", labelKey: "monitoring.range.30d" },
];

const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());

const MONITORING_KEYS = ["trafficEnabled", "retentionDays", "showIps"];
const GEOIP_KEYS = ["accountId", "licenseKey", "editions"];

const pickEditable = (values, keys) => {
	const locked = new Set((values.locked ?? []).map(camel));
	const payload = {};
	for (const key of keys) {
		const skip = locked.has(key) || values[key] === undefined || (key === "licenseKey" && !values[key]);
		if (!skip) payload[key] = values[key];
	}
	return payload;
};

/**
 * Only the editable keys of the traffic statistics settings, without locked ones.
 */
const monitoringSettingsPayload = (values) => pickEditable(values, MONITORING_KEYS);

/**
 * Only the editable keys of the GeoIP settings, without locked ones and without an empty license key.
 */
const geoipSettingsPayload = (values) => pickEditable(values, GEOIP_KEYS);

/**
 * Tabler colour for an error rate (0..1): secondary below 1 %, orange from 1 %, red from 5 %.
 */
const errorRateColor = (rate) => {
	if (rate >= 0.05) return "red";
	if (rate >= 0.01) return "orange";
	return "secondary";
};

/**
 * Points for an SVG polyline: one point per value spread over width, scaled to height with `pad` room at the
 * top and bottom. Returns { line, area } point strings; all-zero or empty input gives a flat line at the bottom.
 */
const sparklinePoints = (values, width, height, pad = 2) => {
	const list = (values ?? []).map((v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0));
	if (list.length === 0) return { line: "", area: "" };
	const max = Math.max(...list);
	const step = list.length > 1 ? width / (list.length - 1) : 0;
	const coords = list.map((v, i) => {
		const x = Math.round(i * step * 100) / 100;
		const y = max > 0 ? height - pad - (v / max) * (height - 2 * pad) : height - pad;
		return [x, Math.round(y * 100) / 100];
	});
	const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
	const last = coords[coords.length - 1][0];
	return { line, area: `0,${height} ${line} ${last},${height}` };
};

export {
	chartSeries,
	countryName,
	errorRateColor,
	filterBans,
	formatBytes,
	formatCount,
	geoipSettingsPayload,
	hostOptions,
	isCountryCode,
	mapScale,
	monitoringSettingsPayload,
	OTHER_HOST,
	rangeOptions,
	secondsLeftNow,
	shareBar,
	sparklinePoints,
	timeLeftParts,
};
