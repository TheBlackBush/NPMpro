/**
 * The rules of the webhook list: the status of a row, the events column, the last delivery and the texts of a test. Pure,
 * so node --test checks them without a DOM. The window's rules are in WebhookWindowForms.js (loaded with the window).
 */

export const ALL_EVENTS = "*";

// the backend fails a webhook after this many days without a success (backend internal/notify FAILING_AFTER_MS)
export const FAILING_DAYS = 3;

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
