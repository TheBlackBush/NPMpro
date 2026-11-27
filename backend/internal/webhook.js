import db from "../db.js";
import errs from "../lib/error.js";
import { isSelectable } from "../lib/notify/catalogue.js";
import { dbTimeOf, msOfDbTime } from "../lib/notify/db-time.js";
import { sealWebhookText } from "../lib/notify/webhook-seal.js";
import { newSecret } from "../lib/notify/webhook-sign.js";
import { checkWebhookTarget, urlHint, validateWebhookUrl } from "../lib/notify/webhook-url.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import Webhook from "../models/webhook.js";
import internalAuditLog from "./audit-log.js";
import { queue, webhookChannel, worker } from "./notify.js";

// The webhook service: the webhooks of Settings, Notifications. The URL and the signing secrets are stored sealed and
// every write of them goes through seal(); they never appear in an answer (an answer has url_hint and the flags), an
// audit row (name, id, events) or a log line. A new secret is answered once, by the call that made it.

const DELIVERY_TABLE = "npmpro_notification_delivery";
const ALL = "*";
const ERROR_PREFIX = /^error\./u;
const PREVIOUS_SECRET_MS = 24 * 3_600_000;
const MAX_PAGE = 100;
const DEFAULT_PAGE = 25;
const DELIVERY_COLUMNS = [
	"id",
	"message_id",
	"event",
	"status",
	"attempts",
	"next_try_on",
	"http_status",
	"duration_ms",
	"error",
	"response",
	"created_on",
	"modified_on",
];

// a URL or a secret becomes a database value only through sealWebhookText (a backup restore uses it too)
const seal = (text) => sealWebhookText(text);

// the clear value of a sealed column, or null when it is empty or cannot be opened
const openOrNull = (sealed) => {
	if (!sealed) return null;
	try {
		return defaultSecretBox.decrypt(sealed);
	} catch {
		return null;
	}
};

const isoOf = (value) => {
	const ms = msOfDbTime(value);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const lastDeliveryOf = (row) =>
	row ? { status: row.status, http_status: row.http_status ?? null, created_on: isoOf(row.created_on) } : null;

// the fields of an answer: never the URL, the secrets or their ciphertext
const present = (row, lastDelivery = null) => {
	const urlSet = Boolean(row.url);
	const secretSet = Boolean(row.secret);
	return {
		id: row.id,
		created_on: isoOf(row.created_on),
		modified_on: isoOf(row.modified_on),
		name: row.name,
		url_hint: urlSet ? row.url_hint : "",
		url_set: urlSet,
		secret_set: secretSet,
		// a value that is stored but cannot be opened (another key): the webhook cannot send until it is saved again
		secret_error: (urlSet && openOrNull(row.url) === null) || (secretSet && openOrNull(row.secret) === null),
		events: row.events,
		enabled: row.enabled,
		verify_tls: row.verify_tls,
		disabled_reason: row.disabled_reason ?? null,
		failing_since: isoOf(row.failing_since),
		last_success_on: isoOf(row.last_success_on),
		last_delivery: lastDeliveryOf(lastDelivery),
	};
};

const refuse = (message, key, values) =>
	new errs.ValidationError(message, `error.${key}`, values ? { values } : undefined);

// one URL: its rules, then the save-time check of what it resolves to
const checkedUrl = async (text) => {
	const checked = validateWebhookUrl(text);
	if (checked.error) throw refuse("The address is not a valid webhook URL", checked.error);
	const host = new URL(checked.url).hostname;
	try {
		await checkWebhookTarget(checked.url);
	} catch (error) {
		// the guard's refusal, a name that does not resolve, or a lookup that failed for now (the admin may retry)
		const key = error?.message_i18n?.replace(ERROR_PREFIX, "") ?? "webhook-host-blocked";
		throw refuse(error?.message ?? "The address may not be used", key, { host });
	}
	return checked.url;
};

// the events of a webhook: "*" alone, or a list of ids a webhook can carry (no repeat)
const checkedEvents = (events) => {
	if (events.includes(ALL)) return [ALL];
	const unknown = events.find((id) => !isSelectable(id, "webhook"));
	if (unknown !== undefined) {
		throw refuse("The event cannot be sent to a webhook", "notify-event-not-for-webhook", {
			event: String(unknown).slice(0, 100),
		});
	}
	return [...new Set(events)];
};

const checkedName = async (name, ownId) => {
	const taken = await Webhook.query()
		.whereRaw("lower(name) = ?", [name.toLowerCase()])
		.whereNot("id", ownId ?? 0)
		.first();
	if (taken) throw refuse("A webhook with this name exists", "webhook-name-taken");
	return name;
};

// a webhook can be turned on only with a URL and a secret that open
const usable = (row, { urlGiven, secretMade }) =>
	(urlGiven || openOrNull(row.url) !== null) && (secretMade || openOrNull(row.secret) !== null);
const unusable = () =>
	refuse("Rotate the secret or save the URL again before enabling the webhook", "webhook-secret-unusable");

const urlRequired = () => refuse("Enter the URL of the webhook", "webhook-url-required");

const auditMeta = (row) => ({ name: row.name, id: row.id, events: row.events });
const audit = (access, action, row) =>
	internalAuditLog.add(access, { action, object_type: "webhook", object_id: row.id, meta: auditMeta(row) });

const find = async (id) => {
	const row = await Webhook.query().findById(id);
	if (!row) throw new errs.ItemNotFoundError(id);
	return row;
};

const lastDeliveries = async (ids) => {
	if (ids.length === 0) return new Map();
	const knex = db();
	const newest = await knex(DELIVERY_TABLE)
		.where({ channel: "webhook" })
		.whereIn("target_id", ids)
		.groupBy("target_id")
		.select("target_id")
		.max({ id: "id" });
	if (newest.length === 0) return new Map();
	const rows = await knex(DELIVERY_TABLE)
		.select("target_id", "status", "http_status", "created_on")
		.whereIn(
			"id",
			newest.map((row) => row.id),
		);
	return new Map(rows.map((row) => [Number(row.target_id), row]));
};

const pageOf = (value, fallback, max) => {
	const number = Number(value);
	return Number.isInteger(number) && number >= 0 ? Math.min(number, max) : fallback;
};

const presentDelivery = ({ has_payload: hasPayload, ...row }) => ({
	...row,
	next_try_on: isoOf(row.next_try_on),
	created_on: isoOf(row.created_on),
	modified_on: isoOf(row.modified_on),
	// the payload itself is never answered; a failed row keeps it for a week and can be sent again meanwhile
	redeliverable: Boolean(Number(hasPayload)),
});

const deliveryRow = async (webhookId, deliveryId) => {
	const row = await db()(DELIVERY_TABLE)
		.select(...DELIVERY_COLUMNS)
		.select(db().raw("(payload IS NOT NULL) AS has_payload"))
		.where({ id: deliveryId, channel: "webhook", target_id: webhookId })
		.first();
	if (!row) throw new errs.ItemNotFoundError(deliveryId);
	return row;
};

const internalWebhook = {
	/** @returns {Promise<Object[]>} every webhook by name, with the state of its newest delivery */
	list: async (access) => {
		access.canAdmin();
		const rows = await Webhook.query().orderBy("name");
		const last = await lastDeliveries(rows.map((row) => row.id));
		return rows.map((row) => present(row, last.get(row.id)));
	},

	get: async (access, id) => {
		access.canAdmin();
		const row = await find(id);
		return present(row, (await lastDeliveries([row.id])).get(row.id));
	},

	/**
	 * @param   {Object}  access
	 * @param   {Object}  data  { name, url, events, enabled, verify_tls }
	 * @returns {Promise<Object>}  the webhook with `secret` (this answer only)
	 */
	create: async (access, data) => {
		access.canAdmin();
		const name = await checkedName(data.name);
		const events = checkedEvents(data.events);
		const url = await checkedUrl(data.url);
		const secret = newSecret();
		const row = await Webhook.query().insertAndFetch({
			name,
			url: seal(url),
			url_hint: urlHint(url),
			secret: seal(secret),
			events,
			enabled: data.enabled ?? true,
			verify_tls: data.verify_tls ?? true,
		});
		await audit(access, "created", row);
		return { ...present(row), secret };
	},

	/**
	 * An empty or missing url keeps the stored one; a new one is checked. Enabling clears the disabled reason and the
	 * failing period. A webhook disabled by a restore needs its URL and gets a new secret (answered once).
	 */
	update: async (access, id, data) => {
		access.canAdmin();
		const row = await find(id);
		const restored = row.disabled_reason === "restore" || !row.url;
		const newUrl = typeof data.url === "string" && data.url.length > 0 ? data.url : null;
		if (restored && newUrl === null) throw urlRequired();
		const patch = {};
		if (data.name !== undefined && data.name !== row.name) patch.name = await checkedName(data.name, row.id);
		if (data.events !== undefined) patch.events = checkedEvents(data.events);
		if (data.verify_tls !== undefined) patch.verify_tls = data.verify_tls;
		if (newUrl !== null) {
			const url = await checkedUrl(newUrl);
			Object.assign(patch, { url: seal(url), url_hint: urlHint(url) });
		}
		let secret;
		if (restored) {
			secret = newSecret();
			Object.assign(patch, {
				secret: seal(secret),
				previous_secret: null,
				previous_secret_until: null,
				disabled_reason: null,
			});
		}
		// entering the URL of a restored webhook again is what was missing: it is on again unless the save says off
		if (data.enabled !== undefined) patch.enabled = data.enabled;
		else if (restored) patch.enabled = true;
		if (patch.enabled === true && !row.enabled && !usable(row, { urlGiven: newUrl !== null, secretMade: restored }))
			throw unusable();
		if (patch.enabled === true) Object.assign(patch, { disabled_reason: null, failing_since: null });
		const updated = await Webhook.query().patchAndFetchById(row.id, patch);
		if (patch.enabled === false) await queue.dropTarget("webhook", row.id);
		await audit(access, "updated", updated);
		const answer = present(updated, (await lastDeliveries([row.id])).get(row.id));
		return secret === undefined ? answer : { ...answer, secret };
	},

	/** Drops the pending rows, then removes the webhook and its deliveries */
	remove: async (access, id) => {
		access.canAdmin();
		const row = await find(id);
		await queue.dropTarget("webhook", row.id);
		await db().transaction(async (trx) => {
			await trx(DELIVERY_TABLE).where({ channel: "webhook", target_id: row.id }).delete();
			await trx("npmpro_webhook").where({ id: row.id }).delete();
		});
		await audit(access, "deleted", row);
		return true;
	},

	/** A new secret (answered once); the old one signs too for 24 hours */
	rotate: async (access, id) => {
		access.canAdmin();
		const row = await find(id);
		const previous = openOrNull(row.secret);
		const secret = newSecret();
		const patch = {
			secret: seal(secret),
			previous_secret: previous === null ? null : seal(previous),
			previous_secret_until: previous === null ? null : dbTimeOf(db())(Date.now() + PREVIOUS_SECRET_MS),
		};
		const updated = await Webhook.query().patchAndFetchById(row.id, patch);
		await audit(access, "secret-rotated", updated);
		return { ...present(updated, (await lastDeliveries([row.id])).get(row.id)), secret };
	},

	/** One notification.test now, outside the queue; the answer is the attempt's outcome */
	test: async (access, id) => {
		access.canAdmin();
		const row = await find(id);
		if (!row.url) throw urlRequired();
		const result = await webhookChannel.sendTest(row);
		await audit(access, "test-sent", row);
		return result;
	},

	/** @returns {Promise<{rows: Object[], total: Number}>} the deliveries of one webhook, newest first, never the payload */
	deliveries: async (access, id, { offset, limit } = {}) => {
		access.canAdmin();
		await find(id);
		const where = () => db()(DELIVERY_TABLE).where({ channel: "webhook", target_id: id });
		const rows = await where()
			.select(...DELIVERY_COLUMNS)
			.select(db().raw("(payload IS NOT NULL) AS has_payload"))
			.orderBy("id", "desc")
			.limit(pageOf(limit, DEFAULT_PAGE, MAX_PAGE) || DEFAULT_PAGE)
			.offset(pageOf(offset, 0, Number.MAX_SAFE_INTEGER));
		const [{ total }] = await where().count({ total: "*" });
		return { rows: rows.map(presentDelivery), total: Number(total) };
	},

	/**
	 * A new attempt of a delivery: the same row and message id, pending, due now. Only while the payload is kept (a
	 * failed row, for a week) and the webhook is enabled; the 409s say which.
	 */
	redeliver: async (access, id, deliveryId) => {
		access.canAdmin();
		const hook = await find(id);
		const delivery = await deliveryRow(hook.id, deliveryId);
		if (!Number(delivery.has_payload)) {
			throw new errs.ConflictError(
				"The content of this delivery is not kept any more",
				"error.webhook-payload-gone",
			);
		}
		if (!hook.enabled) throw new errs.ConflictError("The webhook is disabled", "error.webhook-disabled");
		const now = dbTimeOf(db())(Date.now());
		const count = await db()(DELIVERY_TABLE)
			.where({ id: delivery.id, status: "failed" })
			.update({ status: "pending", next_try_on: now, modified_on: now });
		if (Number(count) !== 1) {
			throw new errs.ConflictError(
				"This delivery is not waiting for a retry",
				"error.webhook-delivery-not-failed",
			);
		}
		worker.kick();
		return presentDelivery(await deliveryRow(hook.id, delivery.id));
	},
};

export { seal };
export default internalWebhook;
