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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// the three HTTP date forms of RFC 9110 5.6.7: IMF-fixdate and the obsolete rfc850 and asctime forms
const IMF_DATE =
	/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?<day>\d{2}) (?<month>[A-Z][a-z]{2}) (?<year>\d{4}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/u;
const RFC850_DATE =
	/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (?<day>\d{2})-(?<month>[A-Z][a-z]{2})-(?<year>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) GMT$/u;
const ASCTIME_DATE =
	/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?<month>[A-Z][a-z]{2}) (?<day> \d|\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2}) (?<year>\d{4})$/u;
const NOT_SENT = "The webhook is disabled or was deleted, the delivery was not sent";

// a two-digit rfc850 year more than 50 years ahead is the latest past year with those digits (RFC 9110 5.6.7)
const fullYear = (twoDigits, nowMs) => {
	const thisYear = new Date(nowMs).getUTCFullYear();
	const year = thisYear - (thisYear % 100) + twoDigits;
	return year > thisYear + 50 ? year - 100 : year;
};

/**
 * An HTTP date in one of its three forms, checked strictly (Date.parse alone is too lenient: "foo 5" parses in V8)
 *
 * @returns {Number}  ms, NaN for anything else (also a date that does not exist, such as 31 Feb)
 */
const httpDateMs = (text, nowMs) => {
	const imf = IMF_DATE.exec(text) ?? ASCTIME_DATE.exec(text);
	const match = imf ?? RFC850_DATE.exec(text);
	if (!match) return Number.NaN;
	const { day, month, year, hour, minute, second } = match.groups;
	const parts = [
		imf ? Number(year) : fullYear(Number(year), nowMs),
		MONTHS.indexOf(month),
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	];
	if (parts[1] < 0) return Number.NaN;
	const date = new Date(Date.UTC(...parts));
	const back = [
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate(),
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds(),
	];
	return back.every((value, index) => value === parts[index]) ? date.getTime() : Number.NaN;
};

/**
 * A Retry-After header: whole seconds, or an HTTP date (IMF-fixdate, rfc850 or asctime); anything else is ignored. At
 * most 24 hours.
 *
 * @param   {String|null|undefined}  value
 * @param   {Number}                 nowMs
 * @returns {Number}  milliseconds to wait, 0 when there is none
 */
const retryAfterOf = (value, nowMs) => {
	const text = String(value ?? "").trim();
	let wait = 0;
	if (SECONDS.test(text)) wait = Number(text) * 1000;
	else wait = httpDateMs(text, nowMs) - nowMs;
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

// the spellings of a hidden value an answer may echo: as it is, percent-decoded, and both with JSON's escaped "\/"
const spellingsOf = (value) => {
	const text = String(value);
	let decoded = text;
	try {
		decoded = decodeURIComponent(text);
	} catch {
		// not percent-encoded text: the plain spelling is enough
	}
	return [text, decoded].flatMap((spelling) => [spelling, spelling.replaceAll("/", "\\/")]);
};

// every spelling of the hidden values, the longest first (so a longer value is replaced before a part of it)
const hiddenSpellings = (hidden) =>
	[...new Set(hidden.filter(Boolean).flatMap(spellingsOf))]
		.filter((spelling) => spelling.length > 0)
		.sort((left, right) => right.length - left.length);

const hide = (text, hidden) => {
	let result = String(text);
	for (const value of hiddenSpellings(hidden)) result = result.split(value).join("***");
	return result;
};

// at most `max` bytes of UTF-8, never half a character
const cutBytes = (text, max) => {
	if (Buffer.byteLength(text) <= max) return text;
	let bytes = 0;
	let end = 0;
	for (const char of text) {
		bytes += Buffer.byteLength(char);
		if (bytes > max) break;
		end += char.length;
	}
	return text.slice(0, end);
};

// reads at most `limit` bytes of the answer and stops; a read error after the status is known keeps what was read. A
// character cut at the limit is left out.
const readCapped = async (response, limit) => {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks = [];
	let total = 0;
	try {
		while (total < limit) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
	} catch {
		// the status decides the outcome
	}
	await reader.cancel().catch(() => {});
	return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit), { stream: true });
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

	const request = async ({ hook, url, headers, body, readLimit }) => {
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
			const text = await readCapped(response, readLimit);
			// the answer did not end within the time (the abort stopped the read): a timeout like no answer at all
			if (timedOut) return { error: describeError(null, true) };
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
			const parsedUrl = new URL(url);
			const bits = [parsedUrl.href, parsedUrl.search, parsedUrl.hash, ...hidden];
			// enough to hide a value that starts just before the cut: the answer is hidden first, then cut
			const longest = Math.max(0, ...hiddenSpellings(bits).map((value) => Buffer.byteLength(value)));
			const answer = await request({ hook, url, ...built, readLimit: MAX_RESPONSE_BYTES + longest });
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

	const sendRow = async (row, waits) => {
		const started = clock.now();
		let hook;
		try {
			hook = await webhooks.get(Number(row.target_id));
		} catch (error) {
			log?.warn?.(`webhook: the webhook could not be read: ${safeError(error?.message ?? String(error))}`);
			return { id: row.id, ok: false, retry: true, error: "The webhook could not be read" };
		}
		if (!hook?.enabled) return { id: row.id, ok: false, retry: false, dropped: true, error: NOT_SENT };
		const failedUntil = waits.get(hook.id);
		if (failedUntil !== undefined) return { id: row.id, ok: false, deferred: true, next_try_ms: failedUntil };
		const outcome = await attempt(row, hook);
		const duration_ms = clock.now() - started;
		let disabled = false;
		if (outcome.ok || outcome.book) disabled = await book(hook, outcome);
		const result = { id: row.id, duration_ms, http_status: outcome.http_status };
		if (outcome.response !== undefined) {
			result.response = cutBytes(hide(outcome.response, outcome.hidden ?? []), MAX_RESPONSE_BYTES);
		}
		if (outcome.ok) return { ...result, ok: true };
		const text = scrub(outcome.fail, outcome.hidden ?? []);
		const retry = outcome.retry && !disabled;
		const delay = RETRY_DELAYS[Number(row.attempts)];
		if (!retry || delay === undefined) return { ...result, ok: false, retry: false, error: text };
		const jittered = Math.round(delay * (1 + random() * JITTER));
		const retryAfterMs = Math.max(jittered, outcome.retryAfter ?? 0);
		// a request that failed: the webhook's other rows of this call wait for this row's next try, untried
		if (outcome.book) waits.set(hook.id, clock.now() + retryAfterMs);
		return {
			...result,
			ok: false,
			retry: true,
			error: text,
			retry_after_ms: retryAfterMs,
		};
	};

	return {
		id: "webhook",
		retryDelays: RETRY_DELAYS,
		maxConcurrent: MAX_CONCURRENT,
		// the worker sends all claimed rows of one webhook in one call, so a dead receiver costs one attempt per pass
		sendsTargetTogether: true,
		accepts: async (type) => (await webhooks.forEvent(type)).length > 0,
		targets: async (envelope) => (await webhooks.forEvent(envelope.type)).map((hook) => ({ target_id: hook.id })),
		send: async (rows) => {
			// webhook id => ms of the next try of its row that failed in this call
			const waits = new Map();
			const results = [];
			for (const row of rows) results.push(await sendRow(row, waits));
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
