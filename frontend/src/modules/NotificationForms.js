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

// the backend's alert limits (lib/mail/settings-rules.js)
export const ALERT_ADDRESSES_MAX = 20;
export const REMINDER_HOURS_MAX = 168;

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
	alertsAdmins: data.alertsAdmins ?? true,
	alertsAddresses: [...(data.alertsAddresses ?? [])],
	alertsEvents: [...(data.alertsEvents ?? [])],
	reminderHours: String(data.reminderHours ?? 24),
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
		if (
			!(
				isNotificationsLocked("alertsAddresses") ||
				sameList(values.alertsAddresses, savedNotifications.alertsAddresses)
			)
		) {
			const error = addressListValidate(values.alertsAddresses);
			if (error) errors.alertsAddresses = rules.message(error.id, error.values);
		}
		if (
			"reminderHours" in values &&
			!(isNotificationsLocked("reminderHours") || kept("reminderHours", savedNotifications))
		) {
			const id = reminderHoursValidate(values.reminderHours);
			if (id) errors.reminderHours = rules.message(id, { max: REMINDER_HOURS_MAX });
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

// two lists are the same: in order, or (asSet) as sets
const sameList = (a, b, asSet = false) => {
	const left = a ?? [];
	const right = b ?? [];
	if (asSet) return left.length === right.length && left.every((item) => right.includes(item));
	return left.length === right.length && left.every((item, index) => item === right[index]);
};

// the events a save sends: the ticked ones the mail channel offers (a stored id it no longer offers is dropped, the
// backend refuses it); every stored one while the list of offered events is not known
const eventsToSave = (ticked, offered) => {
	if (!offered) return ticked;
	const ids = new Set(offered.map((event) => event.id));
	return ticked.filter((id) => ids.has(id));
};

/**
 * What a save changes in the notification settings; null when nothing changes
 *
 * @param   {Object}  values
 * @param   {Object}  data  the stored settings
 * @param   {{ id: string }[]} [offeredEvents]  GET /notifications/events, to drop an id mail does not offer
 * @returns {Object|null}
 */
export const notificationPayload = (values, data, offeredEvents) => {
	const isLocked = lockedIn(data.locked);
	const saved = notificationValues(data);
	const next = {
		publicUrl: String(values.publicUrl ?? "").trim(),
		defaultLanguage: values.defaultLanguage,
		alertsAdmins: Boolean(values.alertsAdmins),
		alertsAddresses: (values.alertsAddresses ?? []).map((address) => String(address).trim()),
		alertsEvents: values.alertsEvents ?? [],
		reminderHours: Number(String(values.reminderHours ?? "").trim()),
	};
	const body = {};
	for (const key of Object.keys(next).filter((name) => !isLocked(name))) {
		if (key === "alertsEvents") {
			if (!sameList(next[key], saved[key], true)) body[key] = eventsToSave(next[key], offeredEvents);
		} else if (key === "alertsAddresses") {
			if (!sameList(next[key], saved[key])) body[key] = next[key];
		} else if (key === "reminderHours") {
			if (next[key] !== Number(saved[key])) body[key] = next[key];
		} else if (next[key] !== saved[key]) {
			body[key] = next[key];
		}
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
	alerts_admins: ["settings.notifications.alerts-admins", "settings.notifications.alerts-admins.invalid"],
	alerts_addresses: ["settings.notifications.alerts-addresses", "settings.notifications.alerts-addresses.invalid"],
	alerts_events: ["settings.notifications.alerts-events", "settings.notifications.alerts-events.invalid"],
	reminder_hours: ["settings.notifications.reminder-hours", "settings.notifications.reminder-hours.invalid"],
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

/**
 * The checks of the extra alert addresses: at most 20, each one plain address (the backend's rule)
 *
 * @param   {string[]}  addresses
 * @returns {{ id: string, values: Object }|null}  the translation id and its values, or null
 */
export const addressListValidate = (addresses) => {
	const list = addresses ?? [];
	if (list.length > ALERT_ADDRESSES_MAX) {
		return { id: "settings.notifications.alerts-addresses.too-many", values: { max: ALERT_ADDRESSES_MAX } };
	}
	const bad = list.find((address) => !isSingleAddress(String(address).trim()));
	return bad === undefined
		? null
		: { id: "settings.notifications.alerts-addresses.refused", values: { address: bad } };
};

/**
 * The reminder hours: a whole number from 0 (never) to 168
 *
 * @param   {string}  text
 * @returns {string|null}  the translation id of the error, or null
 */
export const reminderHoursValidate = (text) => {
	const trimmed = String(text ?? "").trim();
	return DIGITS.test(trimmed) && Number(trimmed) <= REMINDER_HOURS_MAX
		? null
		: "settings.notifications.reminder-hours.invalid";
};

// the events the mail channel offers, by area: area id -> [title id, [event id, its one line]]; every id is written
// out whole (check-unused reads them)
const ALERT_AREAS = [
	["certificates", "settings.notifications.alerts.area.certificates"],
	["hosts", "settings.notifications.alerts.area.hosts"],
	["backups", "settings.notifications.alerts.area.backups"],
	["monitoring", "settings.notifications.alerts.area.monitoring"],
	["ddns", "settings.notifications.alerts.area.ddns"],
	["webhooks", "settings.notifications.alerts.area.webhooks"],
];

const ALERT_EVENT_LINES = {
	"certificate.expiring": ["certificates", "settings.notifications.alerts.event.certificate-expiring"],
	"certificate.renewal_failed": ["certificates", "settings.notifications.alerts.event.certificate-renewal-failed"],
	"host.config_error": ["hosts", "settings.notifications.alerts.event.host-config-error"],
	"backup.failed": ["backups", "settings.notifications.alerts.event.backup-failed"],
	"geoip.failed": ["monitoring", "settings.notifications.alerts.event.geoip-failed"],
	"crowdsec.unreachable": ["monitoring", "settings.notifications.alerts.event.crowdsec-unreachable"],
	"ddns.record_failed": ["ddns", "settings.notifications.alerts.event.ddns-record-failed"],
	"ddns.record_stopped": ["ddns", "settings.notifications.alerts.event.ddns-record-stopped"],
	"webhook.disabled": ["webhooks", "settings.notifications.alerts.event.webhook-disabled"],
};

/**
 * The event switches of the Mail alerts card: the events the mail channel offers (never a .resolved twin, ticking an
 * event covers its recovery), grouped by area in a fixed order; an event the UI has no line for is left out, so a raw
 * id never shows
 *
 * @param   {{ id: string, channels: string[] }[]}  events  GET /notifications/events
 * @returns {{ area: string, title: string, events: { id: string, label: string }[] }[]}
 */
export const alertEventGroups = (events) => {
	const offered = (events ?? []).filter(
		({ id, channels }) => Array.isArray(channels) && channels.includes("mail") && !id.endsWith(".resolved"),
	);
	return ALERT_AREAS.map(([area, title]) => ({
		area,
		title,
		events: offered
			.filter(({ id }) => Object.hasOwn(ALERT_EVENT_LINES, id) && ALERT_EVENT_LINES[id][0] === area)
			.map(({ id }) => ({ id, label: ALERT_EVENT_LINES[id][1] })),
	})).filter((group) => group.events.length > 0);
};

/**
 * The address a refused save names: the backend answers its 0-based position of the first bad address
 * (settings.notifications.alerts-addresses.invalid with the value index); the page shows the address itself
 *
 * @param   {unknown}   err        the error thrown by the request
 * @param   {string[]}  addresses  the list that was sent
 * @returns {string|null}
 */
export const refusedAddressOf = (err, addresses) => {
	const error = err?.payload?.error;
	if (error?.message_i18n !== "settings.notifications.alerts-addresses.invalid") return null;
	const address = addresses?.[error.message_values?.index];
	return typeof address === "string" ? address : null;
};

/**
 * The failure of "Send a sample": the failing address of the answer (message_values.address) and how many sends
 * went through, or null for an answer without an address (no recipients, the limiter)
 *
 * @param   {unknown}  err
 * @returns {{ address: string, sent: number, failed: number, skipped: number }|null}
 */
export const sampleFailureOf = (err) => {
	const values = err?.payload?.error?.message_values;
	if (typeof values?.address !== "string") return null;
	const count = (key) => (Number.isInteger(values[key]) ? values[key] : 0);
	return { address: values.address, sent: count("sent"), failed: count("failed"), skipped: count("skipped") };
};

/**
 * The address a refused save marked, while it is still in the list: removing it (or a new save) ends the mark
 *
 * @param   {string|null}  refused    refusedAddressOf of the last refused save
 * @param   {string[]}     addresses  the list now
 * @returns {string|null}
 */
export const stillRefused = (refused, addresses) =>
	refused !== null && (addresses ?? []).includes(refused) ? refused : null;
