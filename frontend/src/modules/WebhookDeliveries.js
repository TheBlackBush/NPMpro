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
 * content is no longer kept (`redeliverable` false) or the webhook is turned off.
 *
 * @param   {{ status: string, redeliverable: boolean }}  delivery
 * @param   {boolean}  webhookEnabled
 * @returns {{ show: boolean, disabled: boolean, reasonId: string|null }}
 */
export const redeliverState = (delivery, webhookEnabled) => {
	if (delivery.status !== "failed") return { show: false, disabled: false, reasonId: null };
	if (!delivery.redeliverable) {
		return { show: true, disabled: true, reasonId: "settings.webhooks.deliveries.payload-gone" };
	}
	if (!webhookEnabled) return { show: true, disabled: true, reasonId: "error.webhook-disabled" };
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
 * @returns {string}
 */
export const formatDeliveryTime = (value, locale, timeZone) =>
	new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "long", hourCycle: "h23", timeZone }).format(
		new Date(value),
	);
