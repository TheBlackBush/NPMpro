import { isIP } from "node:net";
import { hostname } from "node:os";
import addressparser from "nodemailer/lib/addressparser";

const MAIL_LANGUAGES = ["en", "de", "zh", "fr", "es", "pt", "ru", "it", "nl", "pl", "ja", "ko", "uk"];

const EMAIL_DEFAULTS = {
	host: "",
	port: 587,
	security: "starttls",
	verify_tls: true,
	username: "",
	password: "",
	from_address: "",
	from_name: "",
	reply_to: "",
	allow_password_reset: false,
};

const NOTIFICATION_DEFAULTS = {
	public_url: "",
	default_language: "en",
};

const EMAIL_ENV_KEYS = {
	host: "SMTP_HOST",
	port: "SMTP_PORT",
	security: "SMTP_SECURITY",
	verify_tls: "SMTP_VERIFY_TLS",
	username: "SMTP_USERNAME",
	password: "SMTP_PASSWORD",
	from_address: "SMTP_FROM",
	from_name: "SMTP_FROM_NAME",
	reply_to: "SMTP_REPLY_TO",
	allow_password_reset: "PASSWORD_RESET",
};

const NOTIFICATION_ENV_KEYS = {
	public_url: "PUBLIC_URL",
	default_language: "MAIL_LANGUAGE",
};

const EMAIL_NUMBER_KEYS = new Set(["port"]);
// on unless the variable says false
const EMAIL_BOOLEAN_KEYS = new Set(["verify_tls"]);
// off unless the variable says true
const EMAIL_OPT_IN_KEYS = new Set(["allow_password_reset"]);
const SECURITY_MODES = ["starttls", "tls", "none"];
const ADDRESS_PATTERN = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+$/u;
const ASCII_PRINTABLE_PATTERN = /^[\x21-\x7e]+$/u;
const HTTPS_PREFIX_PATTERN = /^https:\/\//iu;
const CONTROL_PATTERN = /[\r\n\0]/u;
const NAME_PATTERN = /[\r\n\0"]/u;
const URL_FORBIDDEN_PATTERN = /[?#\\]/u;
const ADDRESS_MAX = 254;
const NAME_MAX = 100;

/**
 * Stored settings with env vars layered on top over the defaults (env wins per key)
 *
 * @param   {Object}  defaults
 * @param   {Object}  envKeys   key to variable name
 * @param   {Object}  stored    settings meta, password decrypted or absent
 * @param   {Object}  env       process.env or a test object
 * @returns {{values: Object, locked: string[]}}
 */
const mergeWithEnv = (defaults, envKeys, stored, env) => {
	const clean = Object.fromEntries(
		Object.entries(stored ?? {}).filter(([, value]) => value !== null && value !== undefined),
	);
	const values = { ...defaults, ...clean };
	const locked = [];
	for (const [key, name] of Object.entries(envKeys)) {
		const raw = env[name];
		if (raw === undefined || raw === "") continue;
		if (EMAIL_NUMBER_KEYS.has(key)) {
			values[key] = Number(raw);
		} else if (EMAIL_BOOLEAN_KEYS.has(key)) {
			values[key] = raw !== "false";
		} else if (EMAIL_OPT_IN_KEYS.has(key)) {
			values[key] = raw === "true";
		} else {
			values[key] = raw;
		}
		locked.push(key);
	}
	return { values, locked };
};

const mergeEmail = (stored, env) => mergeWithEnv(EMAIL_DEFAULTS, EMAIL_ENV_KEYS, stored, env);

/**
 * The notification settings, the public URL as the origin (PUBLIC_URL=https://NPM.example.com/ gives
 * https://npm.example.com); a value that is not valid stays as it is, so validateNotificationValues names it
 *
 * @param   {Object}  stored
 * @param   {Object}  env
 * @returns {{values: Object, locked: string[]}}
 */
const mergeNotifications = (stored, env) => {
	const merged = mergeWithEnv(NOTIFICATION_DEFAULTS, NOTIFICATION_ENV_KEYS, stored, env);
	const origin = merged.values.public_url ? normalizePublicUrl(merged.values.public_url) : null;
	if (origin) merged.values.public_url = origin;
	return merged;
};

/**
 * Mail is configured when the server and the sender are set (database or env)
 *
 * @param   {Object}  values  the values of mergeEmail
 * @returns {boolean}
 */
const isConfigured = (values) => Boolean(values?.host && values?.from_address);

/**
 * One plain address: no CR, LF or NUL (the library's parser turns them into a group entry), exactly one entry with an
 * address and no group, and the strict pattern on the whole value (no display name, no list)
 *
 * @param   {*}  value
 * @returns {boolean}
 */
const isSingleAddress = (value) => {
	if (typeof value !== "string" || value.length > ADDRESS_MAX || CONTROL_PATTERN.test(value)) return false;
	if (!ASCII_PRINTABLE_PATTERN.test(value) || value.includes("=?") || !ADDRESS_PATTERN.test(value)) return false;
	const entries = addressparser(value);
	return entries.length === 1 && Boolean(entries[0].address) && !entries[0].group;
};

const isPlainText = (value, max, pattern) => typeof value === "string" && value.length <= max && !pattern.test(value);

/**
 * The public URL as stored: the origin (lower-case scheme and host, no trailing slash) of an https URL typed with the
 * literal https:// prefix, printable ASCII only, no path beyond /, no query, fragment or user info; null when invalid
 *
 * @param   {*}  value
 * @returns {string|null}
 */
const normalizePublicUrl = (value) => {
	if (
		typeof value !== "string" ||
		!ASCII_PRINTABLE_PATTERN.test(value) ||
		!HTTPS_PREFIX_PATTERN.test(value) ||
		URL_FORBIDDEN_PATTERN.test(value)
	) {
		return null;
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
		return null;
	}
	return url.origin;
};

const EMAIL_CHECKS = {
	port: (value) => Number.isInteger(value) && value >= 1 && value <= 65535,
	security: (value) => SECURITY_MODES.includes(value),
	verify_tls: (value) => typeof value === "boolean",
	allow_password_reset: (value) => typeof value === "boolean",
	from_address: (value) => value === "" || isSingleAddress(value),
	reply_to: (value) => value === "" || isSingleAddress(value),
	from_name: (value) => isPlainText(value, NAME_MAX, NAME_PATTERN),
	username: (value) => isPlainText(value, ADDRESS_MAX, CONTROL_PATTERN),
};

const NOTIFICATION_CHECKS = {
	public_url: (value) => value === "" || normalizePublicUrl(value) !== null,
	default_language: (value) => MAIL_LANGUAGES.includes(value),
};

const kebab = (key) => key.replaceAll("_", "-");

const errorsOf = (checks, area, values, current) => {
	const errors = {};
	for (const [key, check] of Object.entries(checks)) {
		if (!(key in values)) continue;
		// a stored value passes a save that keeps it, even when it would not pass today
		if (current && values[key] === current[key]) continue;
		if (!check(values[key])) errors[key] = `settings.${area}.${kebab(key)}.invalid`;
	}
	return { errors };
};

/**
 * @param   {Object}  patch    the keys of a save
 * @param   {Object}  current  the stored values (a key kept as stored is not checked again)
 * @returns {{errors: Object<string, string>}}  key to i18n key (settings.email.<field-kebab>.invalid)
 */
const validateEmailPatch = (patch, current) => errorsOf(EMAIL_CHECKS, "email", patch, current);

const validateNotificationsPatch = (patch, current) => errorsOf(NOTIFICATION_CHECKS, "notifications", patch, current);

/**
 * The same rules over the merged values (mergeEmail: stored and env). A value from env or a legacy stored value that a
 * save kept is not checked anywhere else, so the sender (Tasks 2a.3 and 2a.5) calls this before every send and refuses
 * with a config error when it returns errors, and the GET answers the errors.
 *
 * @param   {Object}  values  the values of mergeEmail
 * @returns {{errors: Object<string, string>}}
 */
const validateEmailValues = (values) => errorsOf(EMAIL_CHECKS, "email", values);

/**
 * @param   {Object}  values  the values of mergeNotifications
 * @returns {{errors: Object<string, string>}}
 */
const validateNotificationValues = (values) => errorsOf(NOTIFICATION_CHECKS, "notifications", values);

/**
 * The host of a valid public URL, with its port (for the subject)
 *
 * @param   {Object}  values  the values of mergeNotifications
 * @returns {string|null}
 */
const publicHostOf = (values) => {
	const origin = normalizePublicUrl(values?.public_url);
	return origin ? new URL(origin).host : null;
};

const DOT = ".";

/**
 * The EHLO name (RFC 5321: a domain or an address literal, never a port): the host name of a valid public URL, an IP
 * one as an address literal; without one the container's host name when it is a domain (it holds a dot), else
 * undefined (Nodemailer's own default)
 *
 * @param   {Object}  values      the values of mergeNotifications
 * @param   {string}  [hostName]  the container's host name (os.hostname())
 * @returns {string|undefined}
 */
const ehloNameOf = (values, hostName = hostname()) => {
	const origin = normalizePublicUrl(values?.public_url);
	if (origin) {
		const name = new URL(origin).hostname;
		const bare = name.replace(/^\[|\]$/gu, "");
		if (isIP(bare) === 6) return `[IPv6:${bare}]`;
		if (isIP(bare) === 4) return `[${bare}]`;
		return name;
	}
	return hostName?.includes(DOT) ? hostName : undefined;
};

export {
	EMAIL_DEFAULTS,
	EMAIL_ENV_KEYS,
	ehloNameOf,
	isConfigured,
	isSingleAddress,
	MAIL_LANGUAGES,
	mergeEmail,
	mergeNotifications,
	NOTIFICATION_DEFAULTS,
	NOTIFICATION_ENV_KEYS,
	normalizePublicUrl,
	publicHostOf,
	validateEmailPatch,
	validateEmailValues,
	validateNotificationsPatch,
	validateNotificationValues,
};
