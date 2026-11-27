import { randomInt } from "node:crypto";
import { isIP } from "node:net";
import { fetch as undiciFetch } from "undici";
import Webhook from "../../models/webhook.js";
import { isBlockedAddress, isPrivateLanAddress } from "../blocked-address.js";
import { blockedError, createGuardedAgent } from "../outbound-guard.js";
import { dbTimeOf, msOfDbTime } from "./db-time.js";
import { safeError } from "./queue.js";
import { webhookHeaders } from "./webhook-sign.js";

// The webhook channel of the notification worker. A row is one delivery to one webhook (target_id); its payload is the
// event envelope. Every attempt goes through a guarded agent made at that moment from the stored URL's scheme
// (https: any public host, http: private LAN addresses only), never follows a redirect, sends at most 20 KB and reads at
// most 2 KB of the answer. The URL and the secrets are stored sealed and are opened for the attempt only; they never
// reach an error text, a log line, a delivery row or an audit row.

const RETRY_DELAYS = [5e3, 300e3, 1_800e3, 7_200e3, 18_000e3, 36_000e3, 86_400e3];
const TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 20 * 1024;
const MAX_RESPONSE_BYTES = 2048;
const MAX_RETRY_AFTER_MS = 24 * 3_600_000;
const FAILING_AFTER_MS = 3 * 24 * 3_600_000;
const JITTER = 0.1;
const MAX_CONCURRENT = 5;
const ALL = "*";
const TEST_EVENT = "notification.test";
const SECONDS = /^\d+$/u;
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;
const NOT_SENT = "The webhook is disabled or was deleted, the delivery was not sent";

/**
 * A Retry-After header: whole seconds, or an HTTP date (IMF-fixdate); anything else is ignored. At most 24 hours.
 *
 * @param   {String|null|undefined}  value
 * @param   {Number}                 nowMs
 * @returns {Number}  milliseconds to wait, 0 when there is none
 */
const retryAfterOf = (value, nowMs) => {
	const text = String(value ?? "").trim();
	let wait = 0;
	if (SECONDS.test(text)) wait = Number(text) * 1000;
	else if (HTTP_DATE.test(text)) wait = Date.parse(text) - nowMs;
	return Number.isFinite(wait) && wait > 0 ? Math.min(wait, MAX_RETRY_AFTER_MS) : 0;
};

const BRACKETS = /^\[|\]$/gu;

// a host written as an IP address is checked here at every attempt for the channel's own rule and error text (the
// guarded agent refuses a blocked one before connecting too)
const assertLiteralAllowed = (parsed) => {
	const host = parsed.hostname.replace(BRACKETS, "");
	if (isIP(host) === 0) return;
	if (isBlockedAddress(host) || (parsed.protocol === "http:" && !isPrivateLanAddress(host))) throw blockedError(host);
};

const selects = (events, type) =>
	Array.isArray(events) && (events.includes(type) || (events.includes(ALL) && type !== TEST_EVENT));

/**
 * The webhook rows the channel reads and writes
 *
 * @param   {Object}  options
 * @param   {Object}  options.knex
 * @param   {Object}  options.queue   dropTarget(channel, id)
 * @param   {Object}  [options.clock] { now() } in ms
 */
const createWebhookStore = ({ knex, queue, clock = { now: () => Date.now() } }) => {
	const dbTime = dbTimeOf(knex);
	const query = () => Webhook.query(knex);
	return {
		/** @returns {Promise<Object[]>} the enabled webhooks that select the event */
		forEvent: async (type) => (await query().where({ enabled: true })).filter((hook) => selects(hook.events, type)),

		/** @returns {Promise<Object|undefined>} the row with its sealed values */
		get: (id) => query().findById(id),

		/** A success: last_success_on is now and the failing period ends */
		recordSuccess: async (id) => {
			await query()
				.where({ id })
				.patch({ last_success_on: dbTime(clock.now()), failing_since: null });
		},

		/**
		 * A failed attempt: the failing period starts when there is none
		 *
		 * @returns {Promise<Boolean>}  true when the webhook has been failing for more than 3 days
		 */
		recordFailure: async (id) => {
			const row = await query().findById(id);
			if (!row?.enabled) return false;
			const since = msOfDbTime(row.failing_since);
			if (Number.isNaN(since)) {
				await query()
					.where({ id })
					.patch({ failing_since: dbTime(clock.now()) });
				return false;
			}
			return clock.now() - since > FAILING_AFTER_MS;
		},

		/**
		 * Disables an enabled webhook and drops its pending rows
		 *
		 * @returns {Promise<Boolean>}  false when it was not enabled (nothing changed)
		 */
		disable: async (id, reason) => {
			const count = await query().where({ id, enabled: true }).patch({ enabled: false, disabled_reason: reason });
			if (Number(count) !== 1) return false;
			await queue.dropTarget("webhook", id);
			return true;
		},
	};
};

const defaultClock = () => ({
	now: () => Date.now(),
	setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	clearTimeout: (timer) => globalThis.clearTimeout(timer),
});

// the text of a failed request: a code or the guard's own message, never what the library says about the URL
const describeError = (error, timedOut) => {
	if (timedOut) return `The request timed out after ${TIMEOUT_MS / 1000} seconds`;
	const cause = error?.cause ?? error;
	if (cause?.code === "EBLOCKED") return cause.message;
	return cause?.code ? `The request failed (${cause.code})` : "The request failed";
};

// reads at most 2 KB of the answer and stops; a read error after the status is known keeps what was read
const readCapped = async (response) => {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks = [];
	let total = 0;
	try {
		while (total < MAX_RESPONSE_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
	} catch {
		// the status decides the outcome
	}
	await reader.cancel().catch(() => {});
	return Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
};

/**
 * @param   {Object}    options
 * @param   {Object}    options.webhooks      the store (createWebhookStore)
 * @param   {Function}  options.open          (sealed text) => the clear text; throws for one that cannot be opened
 * @param   {Object}    options.notify        emit(type, source)
 * @param   {Function}  [options.fetchFn]     fetch(url, init) (undici's)
 * @param   {Function}  [options.createAgent] createGuardedAgent(options): called for every attempt
 * @param   {Object}    [options.clock]       { now, setTimeout, clearTimeout }
 * @param   {Function}  [options.random]      () => a number from 0 up to 1 (the retry jitter)
 * @param   {Object}    [options.log]
 * @param   {String}    [options.version]     the app version, for the user agent
 */
const createWebhookChannel = ({
	webhooks,
	open,
	notify,
	fetchFn = undiciFetch,
	createAgent = createGuardedAgent,
	clock = defaultClock(),
	random = () => randomInt(1000) / 1000,
	log,
	version = "0.0.0",
}) => {
	const hide = (text, hidden) => {
		let result = String(text);
		for (const value of hidden) if (value) result = result.split(value).join("***");
		return result;
	};
	const scrub = (text, hidden) => safeError(hide(text, hidden));

	const disable = async (hook, reason) => {
		try {
			if (!(await webhooks.disable(hook.id, reason))) return;
			log?.warn?.(`webhook ${hook.id} was disabled (${reason})`);
			// the webhook is disabled already, so the event never goes to it
			await notify.emit("webhook.disabled", { webhook: { id: hook.id, name: hook.name }, reason });
		} catch (error) {
			log?.warn?.(`webhook ${hook.id} could not be disabled: ${safeError(error?.message ?? String(error))}`);
		}
	};

	// the webhook's own state after an attempt; returns true when the webhook has been disabled
	const book = async (hook, outcome) => {
		try {
			if (outcome.ok) {
				await webhooks.recordSuccess(hook.id);
				return false;
			}
			if (outcome.gone) {
				await disable(hook, "gone");
				return true;
			}
			if (await webhooks.recordFailure(hook.id)) {
				await disable(hook, "failing");
				return true;
			}
		} catch (error) {
			log?.warn?.(`webhook ${hook.id} state not saved: ${safeError(error?.message ?? String(error))}`);
		}
		return false;
	};

	// the body is the envelope without its id (the id travels as the webhook-id header); the signed string is the sent one
	const build = ({ secrets, row }) => {
		const { type, timestamp: at, data } = row.payload;
		const body = JSON.stringify({ type, timestamp: at, data });
		if (Buffer.byteLength(body) > MAX_BODY_BYTES) return null;
		const timestamp = Math.floor(clock.now() / 1000);
		return { body, headers: webhookHeaders({ id: row.message_id, timestamp, body, secrets, version }) };
	};

	const request = async ({ hook, url, headers, body }) => {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new TypeError("scheme");
		const plain = parsed.protocol === "http:";
		const agent = createAgent({ rejectUnauthorized: hook.verify_tls, privateOnly: plain });
		const controller = new AbortController();
		let timedOut = false;
		const timer = clock.setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, TIMEOUT_MS);
		try {
			assertLiteralAllowed(parsed);
			const response = await fetchFn(url, {
				method: "POST",
				headers,
				body,
				redirect: "manual",
				dispatcher: agent,
				signal: controller.signal,
			});
			const text = await readCapped(response);
			return {
				status: response.status,
				retryAfter: response.headers.get("retry-after"),
				text,
			};
		} catch (error) {
			return { error: describeError(error, timedOut) };
		} finally {
			clock.clearTimeout(timer);
			await Promise.resolve(agent.close?.()).catch(() => {});
		}
	};

	const attempt = async (row, hook) => {
		let url;
		let secrets;
		try {
			url = open(hook.url);
			secrets = [open(hook.secret)];
			if (hook.previous_secret && msOfDbTime(hook.previous_secret_until) > clock.now()) {
				secrets.push(open(hook.previous_secret));
			}
		} catch {
			return { fail: "The webhook's address or secret cannot be opened", retry: false, book: true };
		}
		const hidden = [url, ...secrets];
		try {
			if (!row.payload || typeof row.payload !== "object") {
				return { fail: "The delivery has no content", retry: false, hidden };
			}
			const built = build({ secrets, row });
			if (!built) return { fail: "The event is larger than 20 KB, it was not sent", retry: false, hidden };
			const answer = await request({ hook, url, ...built });
			const parsedUrl = new URL(url);
			const bits = [parsedUrl.href, parsedUrl.search, parsedUrl.hash, ...hidden];
			if (answer.error) return { fail: answer.error, retry: true, book: true, hidden: bits };
			const outcome = { http_status: answer.status, response: answer.text, hidden: bits, book: true };
			if (answer.status >= 200 && answer.status < 300) return { ...outcome, ok: true };
			const retryAfter = retryAfterOf(answer.retryAfter, clock.now());
			if (answer.status === 410)
				return { ...outcome, fail: "The endpoint answered 410 (gone)", retry: false, gone: true };
			const label =
				answer.status >= 300 && answer.status < 400 ? "was a redirect (not followed)" : "was an error";
			return { ...outcome, fail: `The endpoint's answer ${label} (${answer.status})`, retry: true, retryAfter };
		} catch (error) {
			return { fail: `The delivery could not be built (${error?.name ?? "error"})`, retry: false, hidden };
		}
	};

	const sendRow = async (row) => {
		const started = clock.now();
		let hook;
		try {
			hook = await webhooks.get(Number(row.target_id));
		} catch (error) {
			log?.warn?.(`webhook: the webhook could not be read: ${safeError(error?.message ?? String(error))}`);
			return { id: row.id, ok: false, retry: true, error: "The webhook could not be read" };
		}
		if (!hook?.enabled) return { id: row.id, ok: false, retry: false, dropped: true, error: NOT_SENT };
		const outcome = await attempt(row, hook);
		const duration_ms = clock.now() - started;
		let disabled = false;
		if (outcome.ok || outcome.book) disabled = await book(hook, outcome);
		const result = { id: row.id, duration_ms, http_status: outcome.http_status };
		if (outcome.response !== undefined) result.response = hide(outcome.response, outcome.hidden ?? []);
		if (outcome.ok) return { ...result, ok: true };
		const text = scrub(outcome.fail, outcome.hidden ?? []);
		const retry = outcome.retry && !disabled;
		const delay = RETRY_DELAYS[Number(row.attempts)];
		if (!retry || delay === undefined) return { ...result, ok: false, retry: false, error: text };
		const jittered = Math.round(delay * (1 + random() * JITTER));
		return {
			...result,
			ok: false,
			retry: true,
			error: text,
			retry_after_ms: Math.max(jittered, outcome.retryAfter ?? 0),
		};
	};

	return {
		id: "webhook",
		retryDelays: RETRY_DELAYS,
		maxConcurrent: MAX_CONCURRENT,
		accepts: async (type) => (await webhooks.forEvent(type)).length > 0,
		targets: async (envelope) => (await webhooks.forEvent(envelope.type)).map((hook) => ({ target_id: hook.id })),
		send: async (rows) => {
			const results = [];
			for (const row of rows) results.push(await sendRow(row));
			return results;
		},
	};
};

export {
	createWebhookChannel,
	createWebhookStore,
	FAILING_AFTER_MS,
	MAX_BODY_BYTES,
	MAX_RESPONSE_BYTES,
	RETRY_DELAYS,
	retryAfterOf,
	TIMEOUT_MS,
};
