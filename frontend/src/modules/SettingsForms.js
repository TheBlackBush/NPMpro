/**
 * The rules of the Settings sections on React Hook Form (Default site, the runtime sections, GeoIP, Logs & monitoring):
 * starting values in the order the section shows its fields, validate functions built from the rules the Formik
 * sections had (the same messages, through createValidations' message), and the requests. Pure, so node --test checks
 * them without a DOM.
 */
import { isEmptyPayload, parseTrustedIps, runtimeSettingsPayload } from "./RuntimeSettings.js";

const snake = (key) => key.replaceAll(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`);

/**
 * isLocked for camelCase keys from the locked keys an API returns (snake_case)
 *
 * @param   {string[]} [locked]
 * @returns {Function} (key) => boolean
 */
export const lockedIn = (locked) => {
	const keys = new Set(locked ?? []);
	return (key) => keys.has(snake(key));
};

/**
 * A section's errors without the fields locked by the environment: a value set by env is the admin's (the backend
 * takes it as it is), so it never blocks saving the other fields
 *
 * @param   {Object}   errors
 * @param   {Function} isLocked  (key) => boolean
 * @returns {Object}
 */
export const unlockedErrors = (errors, isLocked) =>
	Object.fromEntries(Object.entries(errors ?? {}).filter(([key]) => !isLocked(key)));

// Default site

export const DEFAULT_SITE_OPTIONS = ["congratulations", "404", "444", "redirect", "html"];
// the backend's rule (lib/default-site.js): rendered into `return 302 <redirect>;`
const REDIRECT_PATTERN = /^https?:\/\/[^\s;{}"'\\#]+$/u;
const DEFAULT_SITE_FIELDS = { redirect: ["redirect"], html: ["html", "status"] };

/**
 * The starting values of the default site: the status as text, as the input holds it
 *
 * @param   {Object} data  the default-site setting
 * @returns {Object}
 */
export const defaultSiteValues = (data) => ({
	value: data?.value,
	redirect: data?.meta?.redirect || "",
	html: data?.meta?.html || "",
	status: data?.meta?.status ? String(data.meta.status) : "",
});

/**
 * Only the fields of the chosen option are checked (and sent), the others keep their saved values
 *
 * @param   {Object} rules  createValidations(intl)
 * @returns {Function}
 */
export const defaultSiteValidate = (rules) => (values) => {
	const errors = {};
	if (values.value === "redirect") {
		const redirect = values.redirect.trim();
		if (redirect === "") errors.redirect = rules.message("error.required");
		else if (redirect.length > 255) {
			errors.redirect = rules.message("error.max-character-length", { max: 255 });
		} else if (!REDIRECT_PATTERN.test(redirect)) {
			errors.redirect = rules.message("settings.default-site.redirect.invalid");
		}
	}
	if (values.value === "html") {
		if (values.html.trim() === "") errors.html = rules.message("error.required");
		const status = Number(values.status);
		if (values.status !== "" && !(Number.isInteger(status) && status >= 400 && status <= 599)) {
			errors.status = rules.message("settings.default-site.status.invalid");
		}
	}
	return errors;
};

/**
 * The fields an option hides (their messages go with them)
 *
 * @param   {string} option
 * @returns {string[]}
 */
export const defaultSiteHiddenFields = (option) =>
	["redirect", "html", "status"].filter((field) => !(DEFAULT_SITE_FIELDS[option] ?? []).includes(field));

/**
 * The request of a default site save: the chosen option, its fields, the other options' saved values
 *
 * @param   {Object} values
 * @param   {Object} data  the setting as loaded
 * @returns {Object}
 */
export const defaultSitePayload = (values, data) => {
	let meta = { ...data?.meta };
	if (values.value === "redirect") meta = { ...data?.meta, redirect: values.redirect.trim() };
	if (values.value === "html") {
		meta = { ...data?.meta, html: values.html, status: values.status === "" ? undefined : Number(values.status) };
	}
	return { id: "default-site", value: values.value, meta };
};

// Certificates & TLS

export const RENEWAL = { min: 1, max: 499 };
export const ECH = { min: 1, max: 24 };
const PROFILE = /^[A-Za-z0-9._-]{0,64}$/u;

const rangeError = (rules, value, { min, max }) => {
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max
		? null
		: rules.message("settings.runtime.number.invalid", { min, max });
};

export const certificatesValidate = (rules) => (values) => {
	const errors = {};
	const renewal = rangeError(rules, values.renewalInterval, RENEWAL);
	if (renewal) errors.renewalInterval = renewal;
	const ech = rangeError(rules, values.echRotationInterval, ECH);
	if (ech) errors.echRotationInterval = ech;
	if (!PROFILE.test(values.profile.trim())) {
		errors.profile = rules.message("settings.certificates.profile.invalid");
	}
	return errors;
};

// nginx

// the backend's rules (lib/runtime-rules.js)
const TIME_VALUE = /^[0-9]+(?:ms|s|m|h|d|w|M|y)?(?:[0-9]+(?:ms|s|m|h|d|w|M|y))*$/u;
const TIME_TOKEN = /([0-9]+)(ms|s|m|h|d|w|M|y)?/gu;
const TIME_UNITS = ["y", "M", "w", "d", "h", "m", "s", "ms"];

/**
 * nginx's time parser: "0", or tokens of digits plus a unit with the units strictly decreasing, each at most once; a
 * bare number (seconds) is only valid as the whole value
 *
 * @param   {string}  value
 * @returns {boolean}
 */
export const isNginxTime = (value) => {
	if (value.length > 32 || !TIME_VALUE.test(value)) return false;
	if (value === "0") return true;
	const tokens = [...value.matchAll(TIME_TOKEN)];
	let last = -1;
	for (const [, , unit] of tokens) {
		if (unit === undefined) return tokens.length === 1;
		const index = TIME_UNITS.indexOf(unit);
		if (index <= last) return false;
		last = index;
	}
	return true;
};

export const nginxValidate = (rules) => (values) => {
	const errors = {};
	const connections = Number(values.workerConnections);
	if (!Number.isInteger(connections) || connections < 64 || connections > 65535) {
		errors.workerConnections = rules.message("settings.runtime.number.invalid", { min: 64, max: 65535 });
	}
	const timeout = String(values.workerShutdownTimeout ?? "").trim();
	if (!isNginxTime(timeout)) {
		errors.workerShutdownTimeout = rules.message("settings.nginx.shutdown-timeout.invalid");
	}
	return errors;
};

// Network

// the backend accepts at most this many entries (schema/paths/settings/runtime/network/put.json)
const MAX_TRUSTED_IPS = 1000;

export const networkValidate = (rules) => (values) => {
	const { list, errors } = parseTrustedIps(values.trustedIps);
	if (errors.length > 0) {
		return { trustedIps: errors.map(({ line, message }) => rules.message(message, { line })).join(" ") };
	}
	if (list.length > MAX_TRUSTED_IPS) {
		return { trustedIps: rules.message("settings.network.trusted-ips.too-many", { max: MAX_TRUSTED_IPS }) };
	}
	return {};
};

// Forward authentication

// provider names are product names, shown as they are
export const FORWARD_AUTH_PROVIDERS = [
	{ name: "anubisUpstream", provider: "Anubis", example: "http://127.0.0.1:8923" },
	{ name: "tinyauthUpstream", provider: "Tinyauth", example: "http://127.0.0.1:3000" },
	{ name: "oauth2proxyUpstream", provider: "OAuth2 Proxy", example: "http://127.0.0.1:4180" },
	{ name: "voidauthUpstream", provider: "VoidAuth", example: "http://127.0.0.1:3000" },
	{ name: "autheliaUpstream", provider: "Authelia", example: "http://127.0.0.1:9091" },
	{ name: "authentikUpstream", provider: "Authentik", example: "https://127.0.0.1:9443" },
];

/**
 * Each upstream: a URL (the trimmed value), at most 255 characters (the backend's limit,
 * schema/paths/settings/runtime/forward-auth/put.json); the rule each Formik field had
 */
export const forwardAuthValidate = (rules) => {
	const checkUrl = rules.validateUpstreamUrl();
	const checkUpstream = (value) =>
		value && value.length > 255 ? rules.message("error.max-character-length", { max: 255 }) : checkUrl(value);
	return (values) => {
		const errors = {};
		for (const { name } of FORWARD_AUTH_PROVIDERS) {
			const message = checkUpstream(values[name]?.trim());
			if (message) errors[name] = message;
		}
		return errors;
	};
};

// GeoIP

export const GEOIP_EDITIONS = [
	{ value: "GeoLite2-Country", key: "country" },
	{ value: "GeoLite2-ASN", key: "asn" },
	{ value: "GeoLite2-City", key: "city" },
];
const EDITION_ORDER = GEOIP_EDITIONS.map((edition) => edition.value);
const ACCOUNT_ID = /^[0-9]{0,10}$/u;
const sameEditions = (a, b) => a.length === b.length && a.every((edition) => b.includes(edition));

/**
 * The editions in the API's order, so an unchanged selection is not seen as a change
 *
 * @param   {string[]} editions
 * @returns {string[]}
 */
const inEditionOrder = (editions) => EDITION_ORDER.filter((edition) => editions.includes(edition));

export const geoipValues = (data) => ({
	accountId: data.accountId ?? "",
	licenseKey: "",
	editions: inEditionOrder(data.editions ?? []),
});

/**
 * @param   {Object}   rules
 * @param   {Function} isLocked  (key) => boolean
 * @returns {Function}
 */
export const geoipValidate = (rules, isLocked) => (values) => {
	const errors = {};
	if (!isLocked("accountId") && !ACCOUNT_ID.test(values.accountId.trim())) {
		errors.accountId = rules.message("settings.geoip.account-id.invalid");
	}
	if (!isLocked("licenseKey") && values.licenseKey.length > 255) {
		errors.licenseKey = rules.message("error.max-character-length", { max: 255 });
	}
	return errors;
};

/**
 * The editions after one is switched on or off
 *
 * @param   {string[]} editions
 * @param   {string}   edition
 * @param   {boolean}  on
 * @returns {string[]}
 */
export const toggleEdition = (editions, edition, on) =>
	inEditionOrder(on ? [...editions, edition] : editions.filter((e) => e !== edition));

/**
 * The request of a GeoIP save and whether the backend starts a download in the background (the account, the key or
 * the editions changed)
 *
 * @param   {Object} values
 * @param   {Object} data  the settings as loaded
 * @returns {{ body: Object, startsDownload: boolean }}
 */
export const geoipRequest = (values, data) => {
	const isLocked = lockedIn(data.locked);
	const accountId = values.accountId.trim();
	const licenseKey = values.licenseKey.trim();
	const startsDownload =
		(!isLocked("accountId") && accountId !== (data.accountId ?? "")) ||
		(!isLocked("licenseKey") && licenseKey !== "") ||
		(!isLocked("editions") && !sameEditions(values.editions, data.editions ?? []));
	return { body: { ...values, accountId, licenseKey, locked: data.locked ?? [] }, startsDownload };
};

// Logs & monitoring

export const RETENTION = { min: 7, max: 365 };
export const VISITORS_CAP = { min: 1000, max: 1_000_000 };
export const ROTATIONS = { min: 1, max: 1000 };
export const KEEP_DAYS = { min: 1, max: 366 };
export const MONITORING_FIELDS = ["trafficEnabled", "retentionDays", "showIps", "uniqueVisitors", "visitorsCap"];

/**
 * The starting values of Logs & monitoring, in the section's order: the log files and GoAccess (the logs runtime
 * group), then the traffic statistics
 *
 * @param   {Object} data  the monitoring settings
 * @param   {Object} logs  the logs runtime group
 * @returns {Object}
 */
export const monitoringValues = (data, logs) => ({
	writeLogFiles: Boolean(logs.writeLogFiles),
	logRotations: String(logs.logRotations),
	goaccess: Boolean(logs.goaccess),
	// null: a GOACLA from the env without --keep-last (locked)
	goaccessKeepDays: logs.goaccessKeepDays === null ? "" : String(logs.goaccessKeepDays),
	goaccessAnonymize: logs.goaccessAnonymize,
	goaccessDropQueryStrings: Boolean(logs.goaccessDropQueryStrings),
	goaccessRealOs: Boolean(logs.goaccessRealOs),
	goaccessResolveHosts: Boolean(logs.goaccessResolveHosts),
	trafficEnabled: Boolean(data.trafficEnabled),
	retentionDays: String(data.retentionDays),
	showIps: Boolean(data.showIps),
	uniqueVisitors: Boolean(data.uniqueVisitors),
	visitorsCap: String(data.visitorsCap ?? 100_000),
});

/**
 * @param   {Object}   rules
 * @param   {string[]} logsLocked  the logs keys locked by env (a GOACLA without --keep-last has no keep days to check)
 * @returns {Function}
 */
export const monitoringValidate = (rules, logsLocked) => (values) => {
	const errors = {};
	const days = Number(values.retentionDays);
	if (!Number.isInteger(days) || days < RETENTION.min || days > RETENTION.max) {
		errors.retentionDays = rules.message("settings.monitoring.retention.invalid", RETENTION);
	}
	const rotations = Number(values.logRotations);
	if (
		!logsLocked.includes("log_rotations") &&
		(!Number.isInteger(rotations) || rotations < ROTATIONS.min || rotations > ROTATIONS.max)
	) {
		errors.logRotations = rules.message("settings.runtime.number.invalid", ROTATIONS);
	}
	const keepDays = Number(values.goaccessKeepDays);
	if (
		!logsLocked.includes("goaccess_keep_days") &&
		(values.goaccessKeepDays === "" ||
			!Number.isInteger(keepDays) ||
			keepDays < KEEP_DAYS.min ||
			keepDays > KEEP_DAYS.max)
	) {
		errors.goaccessKeepDays = rules.message("settings.runtime.number.invalid", KEEP_DAYS);
	}
	const cap = Number(values.visitorsCap);
	if (values.uniqueVisitors && (!Number.isInteger(cap) || cap < VISITORS_CAP.min || cap > VISITORS_CAP.max)) {
		errors.visitorsCap = rules.message("settings.monitoring.visitors-cap.invalid", VISITORS_CAP);
	}
	return errors;
};

const logsApi = (values) => ({
	writeLogFiles: values.writeLogFiles,
	logRotations: Number(values.logRotations),
	goaccess: values.goaccess,
	goaccessKeepDays: Number(values.goaccessKeepDays),
	goaccessAnonymize: values.goaccessAnonymize,
	goaccessDropQueryStrings: values.goaccessDropQueryStrings,
	goaccessRealOs: values.goaccessRealOs,
	goaccessResolveHosts: values.goaccessResolveHosts,
});

/**
 * The requests of a Logs & monitoring save: the logs group with only its changed, unlocked keys (null: nothing to
 * send), the monitoring settings when one of them changed (null otherwise), and what the save switches off (asked
 * first: visitor IPs and unique visitors delete their data, traffic statistics offer to delete theirs)
 *
 * @param   {Object} values
 * @param   {Object} data  the monitoring settings as loaded
 * @param   {Object} logs  the logs runtime group as loaded
 * @returns {{ logs: ?Object, monitoring: ?Object, trafficOff: boolean, ipsOff: boolean, visitorsOff: boolean }}
 */
export const monitoringRequest = (values, data, logs) => {
	const isLocked = lockedIn(data.locked);
	const saved = monitoringValues(data, logs);
	const logsPayload = runtimeSettingsPayload("logs", logsApi(values), logs.locked, logs);
	const monitoring = Object.fromEntries(MONITORING_FIELDS.map((key) => [key, values[key]]));
	const changed = MONITORING_FIELDS.some((key) => monitoring[key] !== saved[key]);
	const payload = {
		...monitoring,
		retentionDays: Number(monitoring.retentionDays),
		visitorsCap: Number(monitoring.visitorsCap),
		locked: data.locked ?? [],
	};
	if (!monitoring.uniqueVisitors) delete payload.visitorsCap;
	return {
		logs: isEmptyPayload(logsPayload) ? null : logsPayload,
		monitoring: changed ? payload : null,
		trafficOff: Boolean(
			changed && data.trafficEnabled && !monitoring.trafficEnabled && !isLocked("trafficEnabled"),
		),
		ipsOff: Boolean(changed && data.showIps && !monitoring.showIps && !isLocked("showIps")),
		visitorsOff: Boolean(
			changed && data.uniqueVisitors && !monitoring.uniqueVisitors && !isLocked("uniqueVisitors"),
		),
	};
};

/**
 * The translation prefix of the dialog when only visitor IPs and/or unique visitors go off
 *
 * @param   {boolean} ipsOff
 * @param   {boolean} visitorsOff
 * @returns {string}
 */
export const monitoringConfirmKey = (ipsOff, visitorsOff) => {
	if (ipsOff && visitorsOff) return "settings.monitoring.both-off";
	return ipsOff ? "settings.monitoring.show-ips" : "settings.monitoring.unique-visitors";
};
