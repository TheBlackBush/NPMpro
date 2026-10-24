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

/**
 * chartSeries output to the shape of the stacked chart: the bucket times, the per-class values (class order, the chart
 * stacks them) and the per-class totals for the legend and the summary.
 */
const chartData = (series) => {
	const list = series ?? [];
	return {
		times: list[0]?.data.map((point) => point[0]) ?? [],
		values: list.map((s) => s.data.map((point) => point[1])),
		totals: list.map((s) => s.data.reduce((sum, point) => sum + point[1], 0)),
	};
};

const HALF_DAY_MS = 43_200_000;

/**
 * Time axis labels, one per bucket; null means no tick there. With `daily` (7d, 30d) only the first bucket of each
 * day gets its label, so a day is named once; the partial first day only when it has at least half a day before the
 * next one. `format(ms)` gives the label text.
 */
const axisLabels = (times, format, daily = false) => {
	const labels = (times ?? []).map((ms) => format(ms));
	if (!daily) return labels;
	const ticks = labels.map((label, i) => (i > 0 && label !== labels[i - 1] ? label : null));
	const next = ticks.findIndex((label) => label !== null);
	if (labels.length > 0 && (next === -1 || times[next] - times[0] >= HALF_DAY_MS)) ticks[0] = labels[0];
	return ticks;
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

const HOST_TYPES = ["proxy", "redirection", "dead"];
const HOST_GROUP_KEYS = { proxy: "proxy-hosts", redirection: "redirection-hosts", dead: "dead-hosts" };
const HOST_VALUE = /^(?<type>proxy|redirection|dead):(?<id>[1-9][0-9]*)$/u;

const isHostId = (id) => Number.isSafeInteger(id) && id > 0;

/**
 * Host filter from the URL: `?host_type=proxy&host_id=12` gives { hostType: "proxy", hostId: 12 } (both must be
 * valid), `?host=_other` gives { host: "_other" }. The old form `?host=proxy:12` is still read, any other `host`
 * value is a single stored host key: { host: value }. Anything else gives {}.
 */
const hostFilterFromSearch = (searchParams) => {
	const type = (searchParams?.get("host_type") ?? "").trim();
	const idText = (searchParams?.get("host_id") ?? "").trim();
	if (HOST_TYPES.includes(type) && /^[1-9][0-9]*$/u.test(idText) && isHostId(Number(idText))) {
		return { hostType: type, hostId: Number(idText) };
	}
	const value = (searchParams?.get("host") ?? "").trim();
	if (value === "") return {};
	const match = HOST_VALUE.exec(value);
	if (match && isHostId(Number(match.groups.id)))
		return { hostType: match.groups.type, hostId: Number(match.groups.id) };
	return { host: value };
};

/**
 * Host filter to URL parameters, on top of a copy of `base` (so range and other parameters stay): `host_type` +
 * `host_id` for a host, `host` for Other hosts or a stored key, none of them for all hosts.
 */
const hostFilterToSearch = (filter, base = new URLSearchParams()) => {
	const params = new URLSearchParams(base);
	params.delete("host");
	params.delete("host_type");
	params.delete("host_id");
	if (HOST_TYPES.includes(filter?.hostType) && isHostId(filter?.hostId)) {
		params.set("host_type", filter.hostType);
		params.set("host_id", String(filter.hostId));
	} else if (typeof filter?.host === "string" && filter.host !== "") {
		params.set("host", filter.host);
	}
	return params;
};

/**
 * Query parameters of the traffic request for a filter (or a plain host key). host_type and host_id are only sent
 * together and for a valid type; they never come with `host`.
 */
const trafficParams = (range, filter) => {
	const params = { range };
	if (typeof filter === "string") {
		if (filter !== "") params.host = filter;
	} else if (HOST_TYPES.includes(filter?.hostType) && isHostId(filter?.hostId)) {
		params.host_type = filter.hostType;
		params.host_id = filter.hostId;
	} else if (filter?.host) {
		params.host = filter.host;
	}
	return params;
};

/**
 * Host filter selection groups: proxy, redirection and 404 hosts, in that order. `labelKey` is the translation id
 * of the group title. `label` of an option is the first domain name, `extra` the number of other names.
 * Hosts without domain names are skipped.
 */
const hostGroups = ({ proxy, redirection, dead } = {}) => {
	const lists = { proxy, redirection, dead };
	return HOST_TYPES.map((type) => ({
		type,
		labelKey: HOST_GROUP_KEYS[type],
		options: (lists[type] ?? [])
			.filter((host) => Array.isArray(host?.domainNames) && host.domainNames.length > 0)
			.map((host) => ({
				value: `${type}:${host.id}`,
				hostType: type,
				hostId: host.id,
				label: host.domainNames[0],
				extra: host.domainNames.length - 1,
				domainNames: host.domainNames,
			})),
	}));
};

/**
 * Name, number of other names and badge type for a Top hosts row. The badge is null for "other".
 */
const hostEntryLabel = (entry) => {
	const type = entry?.hostType;
	if (type === "other") return { name: OTHER_HOST, extra: 0, badge: null };
	const names = Array.isArray(entry?.domainNames) ? entry.domainNames : [];
	const badge = [...HOST_TYPES, "deleted"].includes(type) ? type : null;
	const fallback = badge && badge !== "deleted" && entry?.hostId ? `#${entry.hostId}` : "";
	return { name: entry?.name || names[0] || fallback, extra: Math.max(0, names.length - 1), badge };
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
	axisLabels,
	chartData,
	chartSeries,
	countryName,
	errorRateColor,
	filterBans,
	formatBytes,
	formatCount,
	geoipSettingsPayload,
	hostEntryLabel,
	hostFilterFromSearch,
	hostFilterToSearch,
	hostGroups,
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
	trafficParams,
};
