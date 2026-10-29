const MONITORING_DEFAULTS = {
	traffic_enabled: false,
	retention_days: 30,
	show_ips: false,
	unique_visitors: false,
	visitors_cap: 100000,
	traffic_missing_paths: false,
};
const GEOIP_EDITIONS = ["GeoLite2-Country", "GeoLite2-ASN", "GeoLite2-City"];
const GEOIP_DEFAULTS = { account_id: "", editions: ["GeoLite2-Country", "GeoLite2-ASN"] };
// the env var of each field
const MONITORING_ENV_KEYS = {
	traffic_enabled: "TRAFFIC_STATS",
	retention_days: "TRAFFIC_RETENTION_DAYS",
	show_ips: "TRAFFIC_SHOW_IPS",
	unique_visitors: "TRAFFIC_UNIQUE_VISITORS",
	visitors_cap: "TRAFFIC_VISITORS_CAP",
	traffic_missing_paths: "TRAFFIC_404_PATHS",
};
const GEOIP_ENV_KEYS = {
	account_id: "GEOIP_ACCOUNT_ID",
	license_key: "GEOIP_LICENSE_KEY",
	editions: "GEOIP_EDITIONS",
};
const RETENTION_MIN = 7;
const RETENTION_MAX = 365;
const VISITORS_CAP_MIN = 1000;
const VISITORS_CAP_MAX = 1000000;
const DIGITS = /^\d+$/u;
const WHITESPACE = /\s+/u;

const withoutNulls = (stored) =>
	Object.fromEntries(Object.entries(stored ?? {}).filter(([, value]) => value !== null && value !== undefined));

const isSet = (raw) => raw !== undefined && raw !== "";

/**
 * Stored monitoring settings with env vars layered on top (env wins per field)
 *
 * @param   {Object}  stored  settings meta
 * @param   {Object}  env     process.env or a test object
 * @returns {{values: Object, locked: string[]}}
 */
const mergeMonitoringConfig = (stored, env) => {
	const values = { ...MONITORING_DEFAULTS, ...withoutNulls(stored) };
	const locked = [];
	// only TRAFFIC_STATS sets it: Write log files (LOGROTATE, also turned on by GOA) keeps the access log on by itself
	if (isSet(env.TRAFFIC_STATS)) {
		values.traffic_enabled = env.TRAFFIC_STATS === "true";
		locked.push("traffic_enabled");
	}
	if (isSet(env.TRAFFIC_RETENTION_DAYS) && DIGITS.test(env.TRAFFIC_RETENTION_DAYS.trim())) {
		const days = Number.parseInt(env.TRAFFIC_RETENTION_DAYS, 10);
		values.retention_days = Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, days));
		locked.push("retention_days");
	}
	if (isSet(env.TRAFFIC_SHOW_IPS)) {
		values.show_ips = env.TRAFFIC_SHOW_IPS === "true";
		locked.push("show_ips");
	}
	if (isSet(env.TRAFFIC_UNIQUE_VISITORS)) {
		values.unique_visitors = env.TRAFFIC_UNIQUE_VISITORS === "true";
		locked.push("unique_visitors");
	}
	if (isSet(env.TRAFFIC_VISITORS_CAP) && DIGITS.test(env.TRAFFIC_VISITORS_CAP.trim())) {
		values.visitors_cap = Number.parseInt(env.TRAFFIC_VISITORS_CAP, 10);
		locked.push("visitors_cap");
	}
	if (isSet(env.TRAFFIC_404_PATHS)) {
		values.traffic_missing_paths = env.TRAFFIC_404_PATHS === "true";
		locked.push("traffic_missing_paths");
	}
	// also keeps a stored value that is out of range usable
	values.visitors_cap = Number.isInteger(values.visitors_cap)
		? Math.min(VISITORS_CAP_MAX, Math.max(VISITORS_CAP_MIN, values.visitors_cap))
		: MONITORING_DEFAULTS.visitors_cap;
	return { values, locked };
};

/**
 * Space separated edition names, unknown ones dropped, duplicates removed
 *
 * @param   {string}  raw
 * @returns {string[]}
 */
const parseEditions = (raw) => [
	...new Set(
		String(raw)
			.split(WHITESPACE)
			.filter((name) => GEOIP_EDITIONS.includes(name)),
	),
];

/**
 * Stored GeoIP settings with env vars layered on top (env wins per field)
 *
 * @param   {Object}  stored  settings meta, license_key decrypted or absent
 * @param   {Object}  env     process.env or a test object
 * @returns {{values: Object, locked: string[]}}
 */
const mergeGeoipConfig = (stored, env) => {
	const values = { ...GEOIP_DEFAULTS, ...withoutNulls(stored) };
	const locked = [];
	if (isSet(env.GEOIP_ACCOUNT_ID)) {
		values.account_id = env.GEOIP_ACCOUNT_ID.trim();
		locked.push("account_id");
	}
	if (isSet(env.GEOIP_LICENSE_KEY)) {
		values.license_key = env.GEOIP_LICENSE_KEY.trim();
		locked.push("license_key");
	}
	if (isSet(env.GEOIP_EDITIONS)) {
		const editions = parseEditions(env.GEOIP_EDITIONS);
		if (editions.length > 0) {
			values.editions = editions;
			locked.push("editions");
		}
	}
	return { values, locked };
};

/**
 * Stored GeoIP meta without the license key in any form
 *
 * @param   {Object}  [meta]
 * @returns {Object}  meta without license_key, plus license_key_set
 */
const sanitizeGeoipMeta = (meta) => {
	const { license_key: key, ...rest } = meta ?? {};
	return { ...rest, license_key_set: Boolean(key) };
};

export {
	GEOIP_DEFAULTS,
	GEOIP_EDITIONS,
	GEOIP_ENV_KEYS,
	MONITORING_DEFAULTS,
	MONITORING_ENV_KEYS,
	mergeGeoipConfig,
	mergeMonitoringConfig,
	sanitizeGeoipMeta,
};
