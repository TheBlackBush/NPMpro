import path from "node:path";

// The CrowdSec bouncer settings (Settings, CrowdSec): one entry per key of rootfs/etc/crowdsec.conf.example, in its
// order and with its defaults (test/crowdsec-settings.test.js keeps them equal). The API uses the lower-case names;
// crowdsec.conf is written from the values. Pure, so it is tested without a database or files.

export const HEADER = "# Written by NPMpro from Settings, CrowdSec. Changes here are overwritten.";
export const RET_CODES = [200, 202, 204, 301, 302, 400, 401, 403, 404, 405, 406, 444, 500];
export const BAN_RESPONSES = ["page", "redirect", "status"];
export const SECRET_KEYS = ["api_key", "captcha_secret_key"];
export const CROWDSEC_ENV_KEYS = {
	enabled: "CROWDSEC_ENABLED",
	api_url: "CROWDSEC_LAPI_URL",
	api_key: "CROWDSEC_API_KEY",
	appsec_url: "CROWDSEC_APPSEC_URL",
};

const CROWDSEC_DIR = "/data/crowdsec/";
// no line break (a second KEY=value line) and no # (a comment for NPMpro's own parser)
const SAFE = /^[^\r\n#]*$/u;
const HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:\/[^\s#]*)?$/u;
const REDIRECT = /^(?:https?:\/\/[^\s/?#@]+(?:\/[^\s#]*)?|\/[^\s#]+)$/u;
const EXCLUDE = /^\/[^\s,#]*(?:,\/[^\s,#]*)*$/u;
const LINE_BREAK = /[\r\n]/u;
const DIGITS = /^\d+$/u;
const WHITESPACE = /\s/u;
const TLS_PLACEHOLDERS = new Set(["/path/to/client.crt", "/path/to/client.key"]);
const MAX_TEXT = 1024;
const MAX_URL = 2048;
const MAX_PATH = 255;

const bool = (key, file, value) => ({ key, file, kind: "bool", default: value });
const int = (key, file, min, max, value) => ({ key, file, kind: "int", min, max, default: value });
const optInt = (key, file) => ({ key, file, kind: "optint", min: 1, max: 60000, default: null });
const choice = (key, file, values, value) => ({ key, file, kind: "enum", values, default: value });
const text = (key, file, kind, value = "") => ({ key, file, kind, default: value });

export const CROWDSEC_FIELDS = [
	bool("enabled", "ENABLED", false),
	text("api_url", "API_URL", "url", "http://127.0.0.1:8080"),
	text("api_key", "API_KEY", "secret"),
	bool("use_tls_auth", "USE_TLS_AUTH", false),
	text("tls_client_cert", "TLS_CLIENT_CERT", "path"),
	text("tls_client_key", "TLS_CLIENT_KEY", "path"),
	int("cache_expiration", "CACHE_EXPIRATION", 1, 86400, 1),
	choice("bouncing_on_type", "BOUNCING_ON_TYPE", ["all", "ban", "captcha"], "all"),
	choice("fallback_remediation", "FALLBACK_REMEDIATION", ["ban", "captcha"], "ban"),
	int("request_timeout", "REQUEST_TIMEOUT", 100, 60000, 3000),
	int("update_frequency", "UPDATE_FREQUENCY", 1, 86400, 10),
	bool("enable_internal", "ENABLE_INTERNAL", false),
	choice("mode", "MODE", ["live", "stream"], "live"),
	text("scenarios_containing", "SCENARIOS_CONTAINING", "text"),
	text("scenarios_not_containing", "SCENARIOS_NOT_CONTAINING", "text"),
	text("exclude_location", "EXCLUDE_LOCATION", "paths"),
	text("ban_template_path", "BAN_TEMPLATE_PATH", "path", "/data/crowdsec/ban.html"),
	text("redirect_location", "REDIRECT_LOCATION", "redirect"),
	{ key: "ret_code", file: "RET_CODE", kind: "code", default: null },
	choice("captcha_provider", "CAPTCHA_PROVIDER", ["", "recaptcha", "hcaptcha", "turnstile"], ""),
	text("captcha_secret_key", "SECRET_KEY", "secret"),
	text("captcha_site_key", "SITE_KEY", "text"),
	text("captcha_template_path", "CAPTCHA_TEMPLATE_PATH", "path", "/data/crowdsec/captcha.html"),
	int("captcha_expiration", "CAPTCHA_EXPIRATION", 60, 2592000, 3600),
	// empty on new installs (user decision 2026-11-12): AppSec is off until the admin sets it up
	text("appsec_url", "APPSEC_URL", "url", ""),
	choice("appsec_failure_action", "APPSEC_FAILURE_ACTION", ["deny", "passthrough"], "deny"),
	optInt("appsec_connect_timeout", "APPSEC_CONNECT_TIMEOUT"),
	optInt("appsec_send_timeout", "APPSEC_SEND_TIMEOUT"),
	optInt("appsec_process_timeout", "APPSEC_PROCESS_TIMEOUT"),
	bool("always_send_to_appsec", "ALWAYS_SEND_TO_APPSEC", false),
	bool("appsec_drop_unreadable_body", "APPSEC_DROP_UNREADABLE_BODY", true),
	bool("ssl_verify", "SSL_VERIFY", true),
];

// settings of NPMpro that are not bouncer keys: how a ban answers (ruling 6) and the admin UI exemption
const EXTRA_FIELDS = [
	{ key: "ban_response", kind: "enum", values: BAN_RESPONSES, default: "page" },
	{ key: "admin_ui_excluded", kind: "bool", default: false },
];
const ALL_FIELDS = [...CROWDSEC_FIELDS, ...EXTRA_FIELDS];
const FIELD_OF = new Map(ALL_FIELDS.map((field) => [field.key, field]));

export const CROWDSEC_DEFAULTS = Object.fromEntries(ALL_FIELDS.map((field) => [field.key, field.default]));
export const EDITABLE_KEYS = ALL_FIELDS.map((field) => field.key).filter((key) => !SECRET_KEYS.includes(key));

const safeText = (value, max) => typeof value === "string" && value.length <= max && SAFE.test(value);

const isCrowdsecPath = (value) =>
	safeText(value, MAX_PATH) &&
	!WHITESPACE.test(value) &&
	value.startsWith(CROWDSEC_DIR) &&
	value.length > CROWDSEC_DIR.length &&
	!value.endsWith("/") &&
	path.posix.normalize(value) === value;

const inRange = (field, value) => Number.isInteger(value) && value >= field.min && value <= field.max;

/**
 * @param   {Object} field  an entry of CROWDSEC_FIELDS (or the two extra fields)
 * @param   {*}      value
 * @returns {boolean}
 */
export const isValidValue = (field, value) => {
	switch (field.kind) {
		case "bool":
			return typeof value === "boolean";
		case "int":
			return inRange(field, value);
		case "optint":
			return value === null || inRange(field, value);
		case "enum":
			return field.values.includes(value);
		case "code":
			return value === null || RET_CODES.includes(value);
		case "url":
			return value === "" || (safeText(value, MAX_URL) && HTTP_URL.test(value));
		case "redirect":
			return value === "" || (safeText(value, MAX_URL) && REDIRECT.test(value));
		case "path":
			return value === "" || isCrowdsecPath(value);
		case "paths":
			return value === "" || (safeText(value, MAX_TEXT) && EXCLUDE.test(value));
		default:
			return safeText(value, MAX_TEXT);
	}
};

const parseFileValue = (field, raw) => {
	const value = raw.trim();
	switch (field.kind) {
		case "bool": {
			const lower = value.toLowerCase();
			if (lower === "true") return true;
			return lower === "false" ? false : undefined;
		}
		case "int":
			return DIGITS.test(value) ? Number(value) : undefined;
		case "optint":
		case "code":
			if (value === "") return null;
			return DIGITS.test(value) ? Number(value) : undefined;
		case "enum":
			return value.toLowerCase();
		case "path":
			return TLS_PLACEHOLDERS.has(value) ? "" : value;
		default:
			return value;
	}
};

/**
 * The settings of a hand-edited crowdsec.conf (parseConfLines output). A value the rules refuse keeps its default and
 * its key is listed in dropped; keys the settings do not have are listed in unknown. The ban response follows the
 * bouncer: a redirect wins, then an empty ban page path means a bare status code.
 *
 * @param   {Record<string, string>} lines
 * @returns {{ values: Object, unknown: string[], dropped: string[] }}
 */
export const valuesFromFile = (lines) => {
	const byFile = new Map(CROWDSEC_FIELDS.map((field) => [field.file, field]));
	const values = { ...CROWDSEC_DEFAULTS };
	const dropped = [];
	for (const [file, raw] of Object.entries(lines)) {
		const field = byFile.get(file);
		if (!field) continue;
		const value = parseFileValue(field, raw);
		if (value !== undefined && isValidValue(field, value)) values[field.key] = value;
		else dropped.push(file);
	}
	if (values.redirect_location !== "") {
		values.ban_response = "redirect";
	} else if (Object.hasOwn(lines, "BAN_TEMPLATE_PATH") && lines.BAN_TEMPLATE_PATH.trim() === "") {
		values.ban_response = "status";
		values.ban_template_path = CROWDSEC_DEFAULTS.ban_template_path;
	}
	return { values, unknown: Object.keys(lines).filter((file) => !byFile.has(file)), dropped };
};

const ENV_PARSERS = {
	enabled: (raw) => {
		const lower = raw.toLowerCase();
		if (lower === "true") return true;
		return lower === "false" ? false : undefined;
	},
	api_url: (raw) => (safeText(raw, MAX_URL) && HTTP_URL.test(raw) ? raw : undefined),
	api_key: (raw) => (safeText(raw, MAX_TEXT) ? raw : undefined),
	appsec_url: (raw) => (safeText(raw, MAX_URL) && HTTP_URL.test(raw) ? raw : undefined),
};

/**
 * The stored settings (secrets already decrypted) over the defaults, with the env vars on top: a set variable wins and
 * locks its field; a variable whose value the rules refuse is ignored and named in invalid. A stored value the rules
 * refuse falls back to its default.
 *
 * @param   {Object} [stored]
 * @param   {Object} env  process.env or a test object
 * @returns {{ values: Object, locked: string[], invalid: string[] }}
 */
export const mergeCrowdsecConfig = (stored, env) => {
	const values = { ...CROWDSEC_DEFAULTS };
	for (const field of ALL_FIELDS) {
		const value = stored?.[field.key];
		if (value !== undefined && isValidValue(field, value)) values[field.key] = value;
	}
	const locked = [];
	const invalid = [];
	for (const [key, name] of Object.entries(CROWDSEC_ENV_KEYS)) {
		const raw = typeof env?.[name] === "string" ? env[name].trim() : "";
		if (raw === "") continue;
		const value = ENV_PARSERS[key](raw);
		if (value === undefined) {
			invalid.push(name);
			continue;
		}
		values[key] = value;
		locked.push(key);
	}
	return { values, locked, invalid };
};

/**
 * The files the bouncer reads with these values (TLS client files, the ban page, the captcha page)
 *
 * @param   {Object} values
 * @returns {string[]}
 */
export const requiredFiles = (values) => [
	...(values.use_tls_auth ? [values.tls_client_cert, values.tls_client_key].filter(Boolean) : []),
	...(values.ban_response === "page" && values.ban_template_path ? [values.ban_template_path] : []),
	...(values.captcha_provider && values.captcha_template_path ? [values.captcha_template_path] : []),
];

const FILE_LABELS = {
	tls_client_cert: "TLS client certificate file",
	tls_client_key: "TLS client key file",
	ban_template_path: "ban page file",
	captcha_template_path: "captcha page file",
};

/**
 * The rules between fields (the API schema checks each field on its own). Files must exist only while the bouncer is
 * on. Messages are English sentences for the API error.
 *
 * @param   {Object}   values   effective values, secrets in plain text
 * @param   {Object}   options
 * @param   {Function} options.exists  (container path) => boolean
 * @param   {Function} [options.readable]  (container path) => boolean, defaults to exists
 * @returns {string[]}
 */
export const validateCrowdsec = (values, { exists, readable = exists }) => {
	const problems = [];
	if (values.enabled) {
		if (values.api_url === "") problems.push("Enter the LAPI URL.");
		if (!values.use_tls_auth && values.api_key === "") problems.push("Enter the API key of the bouncer.");
	}
	if (values.use_tls_auth && values.enabled) {
		if (values.api_url !== "" && !values.api_url.startsWith("https://")) {
			problems.push("TLS client certificates need an https LAPI URL.");
		}
		for (const key of ["tls_client_cert", "tls_client_key"]) {
			if (values[key] === "") problems.push(`Enter the ${FILE_LABELS[key]} under /data/crowdsec/.`);
		}
	}
	if (values.ban_response === "redirect" && values.redirect_location === "") {
		problems.push("Enter the address banned visitors are sent to.");
	}
	if (values.ban_response === "status" && values.ret_code === null) {
		problems.push("Choose the status code of the answer to a ban.");
	}
	if (values.ban_response === "page" && values.ban_template_path === "") {
		problems.push("Enter the ban page file under /data/crowdsec/, or choose another answer to a ban.");
	}
	if (values.captcha_provider !== "") {
		if (values.captcha_template_path === "") problems.push("Enter the captcha page file under /data/crowdsec/.");
		if (values.captcha_site_key === "") problems.push("Enter the captcha site key.");
		if (values.captcha_secret_key === "") problems.push("Enter the captcha secret key.");
	}
	if (values.enabled) {
		for (const [key, label] of Object.entries(FILE_LABELS)) {
			if (!requiredFiles(values).includes(values[key])) continue;
			if (!exists(values[key])) problems.push(`The ${label} ${values[key]} does not exist.`);
			else if (!readable(values[key])) problems.push(`The ${label} ${values[key]} cannot be read.`);
		}
	}
	return problems;
};

const fileValue = (field, values) => {
	if (field.key === "ban_template_path" && values.ban_response === "status") return "";
	if (field.key === "redirect_location" && values.ban_response !== "redirect") return "";
	if (field.key === "ret_code" && values.ban_response === "redirect") return "";
	const value = values[field.key];
	if (value === null || value === undefined) return "";
	const textValue = String(value);
	if (LINE_BREAK.test(textValue)) throw new Error(`The CrowdSec setting ${field.file} holds a line break`);
	return textValue;
};

/**
 * crowdsec.conf for these values: the header, then KEY=value for every key in the example's order
 *
 * @param   {Object} values  effective values, secrets in plain text
 * @returns {string}
 */
export const renderCrowdsecConf = (values) =>
	`${[HEADER, ...CROWDSEC_FIELDS.map((field) => `${field.file}=${fileValue(field, values)}`)].join("\n")}\n`;

/**
 * The stored meta after a PUT body (validated by the schema): locked fields are not changed; a secret is changed by a
 * non-empty string (stored encrypted), removed by null and kept otherwise; the ban response clears what it does not
 * use (redirect: the status code, page and status: the redirect address).
 *
 * @param   {Object}   stored   the row's meta, secrets sealed
 * @param   {Object}   body
 * @param   {string[]} locked
 * @param   {Function} encrypt  (plain) => sealed
 * @returns {Object}   the new meta
 */
export const applyCrowdsecUpdate = (stored, body, locked, encrypt) => {
	const next = { ...stored };
	for (const key of EDITABLE_KEYS) {
		if (!locked.includes(key) && Object.hasOwn(body, key)) next[key] = body[key];
	}
	for (const key of SECRET_KEYS) {
		if (locked.includes(key) || !Object.hasOwn(body, key)) continue;
		if (body[key] === null) delete next[key];
		else if (typeof body[key] === "string" && body[key].trim() !== "") next[key] = encrypt(body[key].trim());
	}
	if ((next.ban_response ?? CROWDSEC_DEFAULTS.ban_response) === "redirect") next.ret_code = null;
	else next.redirect_location = "";
	return next;
};

/**
 * The names of the settings a save changed, for the audit log: the plain settings by value, the secrets only by name
 * (a new non-empty value, or null that removed a saved one)
 *
 * @param   {Object} before  effective values before the save, secrets in plain text
 * @param   {Object} after   effective values after it
 * @param   {Object} body
 * @param   {string[]} [locked]  fields set by the environment: a secret sent for one is ignored, so it is not a change
 * @returns {string[]}
 */
export const changedCrowdsecKeys = (before, after, body, locked = []) => [
	...EDITABLE_KEYS.filter((key) => before[key] !== after[key]),
	...SECRET_KEYS.filter((key) => {
		if (locked.includes(key) || !Object.hasOwn(body, key)) return false;
		if (body[key] === null) return before[key] !== "";
		return typeof body[key] === "string" && body[key].trim() !== "" && body[key].trim() !== before[key];
	}),
];
