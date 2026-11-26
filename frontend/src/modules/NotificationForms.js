/**
 * The rules of Settings > Notifications (mail server, public URL, default mail language) on React Hook Form: the
 * starting values, the checks (the twin of backend/lib/mail/settings-rules.js), the requests and the browser's
 * address. Pure, so node --test checks them without a DOM.
 */
import { lockedIn } from "./SettingsForms.js";

export const MAIL_LANGUAGES = ["en", "de", "zh", "fr", "es", "pt", "ru", "it", "nl", "pl", "ja", "ko", "uk"];
export const SECURITY_MODES = ["starttls", "tls", "none"];

// the backend's limits and patterns (lib/mail/settings-rules.js)
const ADDRESS_PATTERN = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+$/u;
const ASCII_PRINTABLE_PATTERN = /^[\x21-\x7e]+$/u;
const HTTPS_PREFIX_PATTERN = /^https:\/\//iu;
const CONTROL_PATTERN = /[\r\n\0]/u;
const NAME_PATTERN = /[\r\n\0"]/u;
const URL_FORBIDDEN_PATTERN = /[?#\\]/u;
const DIGITS = /^\d+$/u;
const ADDRESS_MAX = 254;
const NAME_MAX = 100;
const HOST_MAX = 253;
const PUBLIC_URL_MAX = 253;

// the fixed name of the password's variable: the API answers its name blank (it blanks every value under "password")
export const PASSWORD_ENV = "SMTP_PASSWORD";

/**
 * One plain address: printable ASCII, no CR, LF or NUL, no backslash, no encoded word, no display name or list
 *
 * @param   {*}  value
 * @returns {boolean}
 */
export const isSingleAddress = (value) =>
	typeof value === "string" &&
	value.length <= ADDRESS_MAX &&
	!CONTROL_PATTERN.test(value) &&
	ASCII_PRINTABLE_PATTERN.test(value) &&
	!value.includes("=?") &&
	ADDRESS_PATTERN.test(value);

const isPlainText = (value, max, pattern) => typeof value === "string" && value.length <= max && !pattern.test(value);

/**
 * The public URL as the backend stores it: the origin of an https URL typed with the literal https:// prefix,
 * printable ASCII, no path beyond /, no query, fragment or user info; null when invalid
 *
 * @param   {string}  text
 * @returns {string|null}
 */
export const normalizePublicUrl = (text) => {
	if (
		typeof text !== "string" ||
		!ASCII_PRINTABLE_PATTERN.test(text) ||
		!HTTPS_PREFIX_PATTERN.test(text) ||
		URL_FORBIDDEN_PATTERN.test(text)
	) {
		return null;
	}
	let url;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
		return null;
	}
	return url.origin;
};

/**
 * The checks of the public URL field: empty is allowed (not set)
 *
 * @param   {string}  text
 * @returns {string|null}  the translation id of the error, or null
 */
export const publicUrlValidate = (text) => {
	const trimmed = String(text ?? "").trim();
	if (trimmed.length > PUBLIC_URL_MAX) return "error.max-character-length";
	if (trimmed === "" || normalizePublicUrl(trimmed) !== null) return null;
	return "settings.notifications.public-url.invalid";
};

/**
 * The address this page is opened at, for "Use this browser's address": the origin when the page is served over
 * https, else null
 *
 * @param   {{ protocol: string, origin: string }}  location  window.location or a URL
 * @returns {string|null}
 */
export const browserPublicUrl = (location) => (location?.protocol === "https:" ? location.origin : null);

/**
 * The starting values of the mail server card; the password is never shown, so it starts empty
 *
 * @param   {Object}  data  GET /settings/email (camelized)
 * @returns {Object}
 */
export const emailValues = (data) => ({
	host: data.host ?? "",
	port: String(data.port ?? 587),
	security: data.security ?? "starttls",
	verifyTls: data.verifyTls ?? true,
	username: data.username ?? "",
	password: "",
	clearPassword: false,
	fromName: data.fromName ?? "",
	fromAddress: data.fromAddress ?? "",
	replyTo: data.replyTo ?? "",
});

/**
 * @param   {Object}  data  GET /settings/notifications (camelized)
 * @returns {Object}
 */
export const notificationValues = (data) => ({
	publicUrl: data.publicUrl ?? "",
	defaultLanguage: data.defaultLanguage ?? "en",
});

/**
 * The errors of the mail server fields, by field: { id, values? } with the translation id. A field that is empty is
 * fine (the card is simply not configured), except a port that is not a number.
 *
 * @param   {Object}  values
 * @returns {Object<string, { id: string, values?: Object }>}
 */
export const emailValidate = (values) => {
	const errors = {};
	const port = String(values.port ?? "").trim();
	if (!DIGITS.test(port) || Number(port) < 1 || Number(port) > 65535) {
		errors.port = { id: "settings.email.port.invalid" };
	}
	if (!SECURITY_MODES.includes(values.security)) errors.security = { id: "settings.email.security.invalid" };
	if (String(values.host ?? "").trim().length > HOST_MAX) {
		errors.host = { id: "error.max-character-length", values: { max: HOST_MAX } };
	}
	if (!isPlainText(values.username ?? "", ADDRESS_MAX, CONTROL_PATTERN)) {
		errors.username = { id: "settings.email.username.invalid" };
	}
	if (!isPlainText(values.fromName ?? "", NAME_MAX, NAME_PATTERN)) {
		errors.fromName = { id: "settings.email.from-name.invalid" };
	}
	for (const [key, id] of [
		["fromAddress", "settings.email.from-address.invalid"],
		["replyTo", "settings.email.reply-to.invalid"],
	]) {
		const text = String(values[key] ?? "").trim();
		if (text !== "" && !isSingleAddress(text)) errors[key] = { id };
	}
	if (values.password && values.password.length > 1024) {
		errors.password = { id: "error.max-character-length", values: { max: 1024 } };
	}
	return errors;
};

/**
 * The validate function of the form (React Hook Form): the errors of the mail server, the public URL and the
 * language, without the fields set by the environment
 *
 * @param   {Object}    rules      createValidations(intl) (its message)
 * @param   {Function}  isEmailLocked          camelCase key -> locked
 * @param   {Function}  isNotificationsLocked  camelCase key -> locked
 * @param   {Object}    [savedEmail]           emailValues of the stored settings
 * @param   {Object}    [savedNotifications]   notificationValues of the stored settings
 * @returns {Function}
 */
export const notificationsValidate =
	(rules, { isEmailLocked, isNotificationsLocked }, { savedEmail = {}, savedNotifications = {} } = {}) =>
	(values) => {
		const errors = {};
		// a value kept as stored is not checked: the backend keeps a legacy stored value too
		const kept = (key, saved) => key in saved && String(values[key] ?? "").trim() === String(saved[key] ?? "");
		for (const [key, error] of Object.entries(emailValidate(values))) {
			if (!(isEmailLocked(key) || kept(key, savedEmail))) errors[key] = rules.message(error.id, error.values);
		}
		if (!(isNotificationsLocked("publicUrl") || kept("publicUrl", savedNotifications))) {
			const id = publicUrlValidate(values.publicUrl);
			if (id)
				errors.publicUrl = rules.message(
					id,
					id === "error.max-character-length" ? { max: PUBLIC_URL_MAX } : undefined,
				);
		}
		if (
			!(isNotificationsLocked("defaultLanguage") || kept("defaultLanguage", savedNotifications)) &&
			!MAIL_LANGUAGES.includes(values.defaultLanguage)
		) {
			errors.defaultLanguage = rules.message("settings.notifications.default-language.invalid");
		}
		return errors;
	};

const TRIMMED = ["host", "username", "fromName", "fromAddress", "replyTo"];

/**
 * What a save changes in the mail server settings: only the keys that differ from the stored ones, never a key set by
 * the environment; an empty password keeps the saved one, clearPassword removes it. null when nothing changes.
 *
 * @param   {Object}  values
 * @param   {Object}  data  the stored settings
 * @returns {Object|null}
 */
export const emailPayload = (values, data) => {
	const isLocked = lockedIn(data.locked);
	const saved = emailValues(data);
	const next = { ...values, port: Number(String(values.port).trim()) };
	for (const key of TRIMMED) next[key] = String(values[key] ?? "").trim();
	const body = {};
	for (const key of ["host", "port", "security", "verifyTls", "username", "fromName", "fromAddress", "replyTo"]) {
		const same = key === "port" ? next.port === Number(saved.port) : next[key] === saved[key];
		if (!isLocked(key) && !same) body[key] = next[key];
	}
	if (!isLocked("password")) {
		if (values.clearPassword) body.passwordClear = true;
		else if (values.password) body.password = values.password;
	}
	return Object.keys(body).length > 0 ? body : null;
};

/**
 * What a save changes in the notification settings; null when nothing changes
 *
 * @param   {Object}  values
 * @param   {Object}  data  the stored settings
 * @returns {Object|null}
 */
export const notificationPayload = (values, data) => {
	const isLocked = lockedIn(data.locked);
	const saved = notificationValues(data);
	const next = { publicUrl: String(values.publicUrl ?? "").trim(), defaultLanguage: values.defaultLanguage };
	const body = {};
	for (const key of Object.keys(next)) {
		if (!isLocked(key) && next[key] !== saved[key]) body[key] = next[key];
	}
	return Object.keys(body).length > 0 ? body : null;
};

/**
 * Whether Security "None" sends a login: the password would travel unencrypted
 *
 * @param   {Object}  values
 * @returns {boolean}
 */
export const sendsPlainLogin = (values) => values.security === "none" && String(values.username ?? "").trim() !== "";

/**
 * The window of "Send test mail": the address must be one plain address
 *
 * @param   {string}  to
 * @returns {string|null}  the translation id of the error, or null
 */
export const testMailValidate = (to) => (isSingleAddress(String(to ?? "").trim()) ? null : "settings.email.to.invalid");

// config_errors of the two GET answers (backend field names) -> the label and the error text of the field; every id is
// written out whole (check-unused reads them)
const CONFIG_ERRORS = {
	port: ["settings.email.port", "settings.email.port.invalid"],
	security: ["settings.email.security", "settings.email.security.invalid"],
	verify_tls: ["settings.email.verify-tls", "settings.email.verify-tls.invalid"],
	username: ["settings.email.username", "settings.email.username.invalid"],
	from_name: ["settings.email.from-name", "settings.email.from-name.invalid"],
	from_address: ["settings.email.from-address", "settings.email.from-address.invalid"],
	reply_to: ["settings.email.reply-to", "settings.email.reply-to.invalid"],
	public_url: ["settings.notifications.public-url", "settings.notifications.public-url.invalid"],
	default_language: ["settings.notifications.default-language", "settings.notifications.default-language.invalid"],
};

/**
 * The saved values the sender refuses (a restored backup, an env value), as translation ids: the field's label and its
 * error text. A field the UI does not know is left out, so a raw key never shows.
 *
 * @param   {Object}  email          GET /settings/email (camelized; configErrors keeps the backend's field names)
 * @param   {Object}  notifications  GET /settings/notifications
 * @returns {{ field: string, label: string, error: string }[]}
 */
export const configErrorItems = (email, notifications) =>
	[...(email?.configErrors ?? []), ...(notifications?.configErrors ?? [])]
		.filter((field) => Object.hasOwn(CONFIG_ERRORS, field))
		.map((field) => ({ field, label: CONFIG_ERRORS[field][0], error: CONFIG_ERRORS[field][1] }));
