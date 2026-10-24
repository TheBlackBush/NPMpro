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

const COUNT_UNITS = [
	{ size: 1e9, suffix: "B" },
	{ size: 1e6, suffix: "M" },
	{ size: 1e3, suffix: "k" },
];

const shortNumber = (value, size, suffix) => `${(value / size).toFixed(1).replace(/\.0$/u, "")}${suffix}`;

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

const isCountryCode = (code) => typeof code === "string" && /^[A-Za-z]{2}$/u.test(code);

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

export { formatBytes, formatCount, geoipSettingsPayload, mapScale, monitoringSettingsPayload, rangeOptions, shareBar };
