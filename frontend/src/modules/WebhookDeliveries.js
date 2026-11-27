/**
 * The rules of the deliveries window: the badge of a state, the Redeliver button of a row, the detail of a row and the
 * time. Pure, so node --test checks them without a DOM.
 */

// the state of a row: the badge tone and the text id; a row waiting for its next try (a deferred one) is pending
const STATES = {
	pending: { tone: "info", id: "settings.webhooks.delivery.pending" },
	sending: { tone: "info", id: "settings.webhooks.delivery.sending" },
	sent: { tone: "success", id: "settings.webhooks.delivery.sent" },
	failed: { tone: "destructive", id: "settings.webhooks.delivery.failed" },
	dropped: { tone: "muted", id: "settings.webhooks.delivery.dropped" },
};

/**
 * @param   {string}  status  a delivery's status
 * @returns {{ tone: string, id: string }} deferred and unknown states show as pending
 */
export const statusKind = (status) => STATES[status] ?? STATES.pending;

/**
 * The Redeliver button of a row. Only a failed row has one (the backend retries nothing else); it is disabled when the
 * webhook is turned off or the content is no longer kept (`redeliverable` false; the backend answers false for both,
 * the webhook's own switch tells which reason shows).
 *
 * @param   {{ status: string, redeliverable: boolean }}  delivery
 * @param   {boolean}  webhookEnabled
 * @returns {{ show: boolean, disabled: boolean, reasonId: string|null }}
 */
export const redeliverState = (delivery, webhookEnabled) => {
	if (delivery.status !== "failed") return { show: false, disabled: false, reasonId: null };
	if (!webhookEnabled) return { show: true, disabled: true, reasonId: "error.webhook-disabled" };
	if (!delivery.redeliverable) {
		return { show: true, disabled: true, reasonId: "settings.webhooks.deliveries.payload-gone" };
	}
	return { show: true, disabled: false, reasonId: null };
};

/**
 * The text a row opens: the error and the response excerpt, plain text only; null when it has neither
 *
 * @param   {{ error: string|null, response: string|null }}  delivery
 * @returns {{ error: string|null, response: string|null }|null}
 */
export const detailOf = (delivery) => {
	const error = delivery.error || null;
	const response = delivery.response || null;
	return error || response ? { error, response } : null;
};

/**
 * A time in the user's locale with the time zone name
 *
 * @param   {string}  value  an ISO time
 * @param   {string}  locale
 * @param   {string}  [timeZone]  default: the browser's
 * @returns {string} a dash for a missing or invalid time
 */
export const formatDeliveryTime = (value, locale, timeZone) => {
	const date = new Date(value ?? Number.NaN);
	if (Number.isNaN(date.getTime())) return "-";
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "long",
		hourCycle: "h23",
		timeZone,
	}).format(date);
};

export const REFRESH_MS = 10 * 1000;
export const WATCH_REFRESH_MS = 2 * 1000;
export const WATCH_MS = 20 * 1000;

/**
 * How soon the window asks again: every 2 seconds for up to 20 seconds after a redeliver while a row is still pending or
 * sending, else every 10 seconds
 *
 * @param   {{ status: string }[]}  rows
 * @param   {number}  watchUntil  the time (ms) the fast refresh ends; 0 when no redeliver was made
 * @param   {number}  now  ms
 * @returns {number}
 */
export const refreshInterval = (rows, watchUntil, now) =>
	now < watchUntil && rows.some((row) => row.status === "pending" || row.status === "sending")
		? WATCH_REFRESH_MS
		: REFRESH_MS;
