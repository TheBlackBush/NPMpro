/**
 * The rules of the webhook list and window (Settings > Notifications > Webhooks): the starting values, the checks (the
 * twin of backend/lib/notify/webhook-url.js), the request, the status of a row, the event choices and the texts of a
 * test. Pure, so node --test checks them without a DOM.
 */

export const ALL_EVENTS = "*";

// the backend's limits (schema/paths/webhooks, lib/notify/webhook-url.js)
export const WEBHOOK_NAME_MAX = 100;
export const WEBHOOK_URL_MAX = 2048;

const EMPTY_USERINFO = /^[a-z]+:\/\/[^/?#]*@/iu;
const PLAIN_HTTP = /^\s*http:\/\//iu;

// the areas of the event chooser in their order, as { id, title }; every id is written out whole (check-unused reads
// them). The first six titles are the ones of the Mail alerts card.
const AREAS = [
	{ id: "certificates", title: "settings.notifications.alerts.area.certificates" },
	{ id: "hosts", title: "settings.notifications.alerts.area.hosts" },
	{ id: "backups", title: "settings.notifications.alerts.area.backups" },
	{ id: "database", title: "settings.webhooks.area.database" },
	{ id: "monitoring", title: "settings.notifications.alerts.area.monitoring" },
	{ id: "ddns", title: "settings.notifications.alerts.area.ddns" },
	{ id: "webhooks", title: "settings.notifications.alerts.area.webhooks" },
];

// the events a webhook can carry, in the order the window lists them: event id, area, its one line. A `.resolved` twin
// follows its event (the window indents it); an event the backend does not offer for webhooks, or that is not here,
// is left out, so a raw id never shows
const EVENT_LINES = [
	["certificate.expiring", "certificates", "settings.notifications.alerts.event.certificate-expiring"],
	["certificate.expiring.resolved", "certificates", "settings.webhooks.event.certificate-expiring-resolved"],
	["certificate.renewal_failed", "certificates", "settings.notifications.alerts.event.certificate-renewal-failed"],
	[
		"certificate.renewal_failed.resolved",
		"certificates",
		"settings.webhooks.event.certificate-renewal-failed-resolved",
	],
	["certificate.issued", "certificates", "settings.webhooks.event.certificate-issued"],
	["certificate.renewed", "certificates", "settings.webhooks.event.certificate-renewed"],
	["certificate.deleted", "certificates", "settings.webhooks.event.certificate-deleted"],
	["host.config_error", "hosts", "settings.notifications.alerts.event.host-config-error"],
	["host.config_error.resolved", "hosts", "settings.webhooks.event.host-config-error-resolved"],
	["host.created", "hosts", "settings.webhooks.event.host-created"],
	["host.updated", "hosts", "settings.webhooks.event.host-updated"],
	["host.deleted", "hosts", "settings.webhooks.event.host-deleted"],
	["host.enabled", "hosts", "settings.webhooks.event.host-enabled"],
	["host.disabled", "hosts", "settings.webhooks.event.host-disabled"],
	["backup.failed", "backups", "settings.notifications.alerts.event.backup-failed"],
	["backup.failed.resolved", "backups", "settings.webhooks.event.backup-failed-resolved"],
	["backup.succeeded", "backups", "settings.webhooks.event.backup-succeeded"],
	["backup.restored", "backups", "settings.webhooks.event.backup-restored"],
	["database.moved", "database", "settings.webhooks.event.database-moved"],
	["database.move_failed", "database", "settings.webhooks.event.database-move-failed"],
	["geoip.failed", "monitoring", "settings.notifications.alerts.event.geoip-failed"],
	["geoip.failed.resolved", "monitoring", "settings.webhooks.event.geoip-failed-resolved"],
	["crowdsec.unreachable", "monitoring", "settings.notifications.alerts.event.crowdsec-unreachable"],
	["crowdsec.unreachable.resolved", "monitoring", "settings.webhooks.event.crowdsec-unreachable-resolved"],
	["ddns.record_failed", "ddns", "settings.notifications.alerts.event.ddns-record-failed"],
	["ddns.record_failed.resolved", "ddns", "settings.webhooks.event.ddns-record-failed-resolved"],
	["ddns.record_stopped", "ddns", "settings.notifications.alerts.event.ddns-record-stopped"],
	["ddns.record_stopped.resolved", "ddns", "settings.webhooks.event.ddns-record-stopped-resolved"],
	["webhook.disabled", "webhooks", "settings.notifications.alerts.event.webhook-disabled"],
];

/**
 * The event switches of the webhook window: the events the webhook channel offers (GET /notifications/events), grouped
 * by area in a fixed order, a `.resolved` twin right after its event
 *
 * @param   {{ id: string, channels: string[] }[]}  events
 * @returns {{ area: string, title: string, events: { id: string, label: string, resolved: boolean }[] }[]}
 */
export const webhookEventGroups = (events) => {
	const offered = new Set(
		(events ?? [])
			.filter(({ channels }) => Array.isArray(channels) && channels.includes("webhook"))
			.map(({ id }) => id),
	);
	return AREAS.map(({ id, title }) => ({
		area: id,
		title,
		events: EVENT_LINES.filter(([eventId, area]) => area === id && offered.has(eventId)).map(
			([eventId, , label]) => ({
				id: eventId,
				label,
				resolved: eventId.endsWith(".resolved"),
			}),
		),
	})).filter((group) => group.events.length > 0);
};

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The starting values of the window. A webhook restored without its URL starts enabled: entering the URL again is what
 * turns it on, as the backend does when the save does not say otherwise.
 *
 * @param   {Object|null}  webhook  a row of GET /webhooks (camelized), null for a new one
 * @returns {Object}
 */
export const webhookValues = (webhook) => {
	const all = webhook ? webhook.events.includes(ALL_EVENTS) : true;
	return {
		name: webhook?.name ?? "",
		url: "",
		allEvents: all,
		events: webhook && !all ? [...webhook.events] : [],
		verifyTls: webhook?.verifyTls ?? true,
		enabled: webhook ? webhook.enabled || !webhook.urlSet || webhook.disabledReason === "restore" : true,
	};
};

/**
 * The URL a save must hold: a webhook with a stored URL keeps it when the field stays empty; a new one, or one restored
 * without its URL, needs it
 *
 * @param   {Object|null}  webhook
 * @returns {boolean}  true when the URL may stay empty
 */
export const urlMayStayEmpty = (webhook) => Boolean(webhook?.urlSet) && webhook.disabledReason !== "restore";

/**
 * The URL's own errors, as the backend checks them before it resolves the host
 *
 * @param   {string}  text
 * @returns {{ id: string, values?: Object }|null}
 */
const urlError = (text) => {
	if (text.length > WEBHOOK_URL_MAX) return { id: "error.max-character-length", values: { max: WEBHOOK_URL_MAX } };
	let parsed;
	try {
		parsed = new URL(text);
	} catch {
		return { id: "error.webhook-url-invalid" };
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { id: "error.webhook-url-scheme" };
	if (parsed.username || parsed.password || EMPTY_USERINFO.test(text)) return { id: "error.webhook-url-userinfo" };
	if (!parsed.hostname) return { id: "error.webhook-url-invalid" };
	return null;
};

/**
 * The errors of the window, by field: { id, values? } with the translation id
 *
 * @param   {Object}   values
 * @param   {Object}   options
 * @param   {boolean}  options.editing  a stored URL stays when the field is empty (urlMayStayEmpty)
 * @returns {Object<string, { id: string, values?: Object }>}
 */
export const webhookValidate = (values, { editing = false } = {}) => {
	const errors = {};
	const name = String(values.name ?? "").trim();
	if (name === "") errors.name = { id: "error.required" };
	else if (name.length > WEBHOOK_NAME_MAX) {
		errors.name = { id: "error.max-character-length", values: { max: WEBHOOK_NAME_MAX } };
	}
	const url = String(values.url ?? "").trim();
	if (url === "") {
		if (!editing) errors.url = { id: "error.required" };
	} else {
		const error = urlError(url);
		if (error) errors.url = error;
	}
	if (!values.allEvents && (values.events ?? []).length === 0) {
		errors.events = { id: "settings.webhooks.events.required" };
	}
	return errors;
};

/**
 * Whether the typed address is plain http, which the backend allows only for addresses on the local network
 *
 * @param   {string}  url
 * @returns {boolean}
 */
export const isPlainHttp = (url) => PLAIN_HTTP.test(String(url ?? ""));

/**
 * What a save sends: a new webhook all its fields, an edit only the ones that differ from the stored webhook (the URL
 * only when one is typed: empty keeps the stored one). null when nothing changes.
 *
 * @param   {Object}       values
 * @param   {Object|null} webhook  the stored webhook, null for a new one
 * @returns {Object|null}
 */
export const webhookPayload = (values, webhook) => {
	const name = String(values.name).trim();
	const url = String(values.url ?? "").trim();
	const events = values.allEvents ? [ALL_EVENTS] : [...values.events];
	if (!webhook) return { name, url, events, enabled: values.enabled, verifyTls: values.verifyTls };
	const payload = {};
	if (name !== webhook.name) payload.name = name;
	if (url !== "") payload.url = url;
	if (!sameList(events, webhook.events)) payload.events = events;
	if (values.verifyTls !== webhook.verifyTls) payload.verifyTls = values.verifyTls;
	if (values.enabled !== webhook.enabled) payload.enabled = values.enabled;
	return Object.keys(payload).length === 0 ? null : payload;
};

/**
 * The status of a row: the badge kind and the translation id of its reason
 *   active: events are sent; failing: enabled, deliveries fail now (since failingSince); disabled: not sent, with the
 *   reason (by you, the receiver answered 410, failing for 3 days, restored without its URL); error: a stored URL or
 *   secret cannot be opened (saved with another key), which needs a new save or a new secret
 *
 * @param   {Object}  webhook
 * @returns {{ kind: "active"|"failing"|"disabled"|"error", reasonKey: string|null }}
 */
export const statusOf = (webhook) => {
	if (webhook.secretError) return { kind: "error", reasonKey: "settings.webhooks.reason.secret-error" };
	if (!webhook.enabled) {
		const reasonKey = {
			gone: "settings.webhooks.reason.gone",
			failing: "settings.webhooks.reason.failing",
			restore: "settings.webhooks.reason.restore",
		}[webhook.disabledReason];
		return { kind: "disabled", reasonKey: reasonKey ?? "settings.webhooks.reason.user" };
	}
	if (webhook.failingSince) return { kind: "failing", reasonKey: "settings.webhooks.reason.failing-since" };
	return { kind: "active", reasonKey: null };
};

/**
 * The webhooks that turned off without the user's choice can be enabled only after their URL is entered again
 *
 * @param   {Object}  webhook
 * @returns {boolean}
 */
export const needsUrl = (webhook) => !webhook.urlSet || webhook.disabledReason === "restore";

/**
 * The events column: "All events" or the number of chosen events
 *
 * @param   {string[]}  events
 * @returns {{ id: string, values?: Object }}
 */
export const eventsLabel = (events) =>
	(events ?? []).includes(ALL_EVENTS)
		? { id: "settings.webhooks.events.all" }
		: { id: "settings.webhooks.events.count", values: { count: (events ?? []).length } };

// the delivery states, by the id of their text
const DELIVERY_STATES = {
	pending: "settings.webhooks.delivery.pending",
	sending: "settings.webhooks.delivery.sending",
	sent: "settings.webhooks.delivery.sent",
	failed: "settings.webhooks.delivery.failed",
	dropped: "settings.webhooks.delivery.dropped",
};

/**
 * The text id of the last delivery's state; null when the webhook has had no delivery
 *
 * @param   {{ status: string }|null}  lastDelivery
 * @returns {string|null}
 */
export const deliveryStateId = (lastDelivery) => (lastDelivery ? (DELIVERY_STATES[lastDelivery.status] ?? null) : null);

/**
 * The toast of a test delivery
 *
 * @param   {{ ok: boolean, httpStatus: number|null, durationMs: number, error: string|null }}  result
 * @returns {{ ok: boolean, id: string, values: Object }}
 */
export const testOutcome = (result) => {
	if (result.ok) {
		return {
			ok: true,
			id: "settings.webhooks.test.ok",
			values: { status: result.httpStatus, ms: result.durationMs },
		};
	}
	const detail = result.error || (result.httpStatus ? `HTTP ${result.httpStatus}` : "");
	return {
		ok: false,
		id: detail ? "settings.webhooks.test.failed" : "settings.webhooks.test.failed-bare",
		values: { detail, ms: result.durationMs },
	};
};
