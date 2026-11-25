import { engineOf } from "../database/engine.js";
import { clean } from "./catalogue.js";

// The persisted delivery queue (npmpro_notification_delivery). A row is pending, sending, sent, failed or dropped. The
// worker claims due rows (pending to sending), a channel sends them, settle() records the outcome. The payload (the
// envelope or the mail input) is cleared when a row is sent and 7 days after a final failure.

const TABLE = "npmpro_notification_delivery";
const DAY_MS = 24 * 3_600_000;
const FINAL = ["sent", "failed", "dropped"];
const MAX_RESPONSE = 2048;

const URL_USERINFO = /(?<scheme>\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/giu;
const URL_QUERY = /(?<url>\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#]\S*/giu;

/**
 * Error text that is safe to store and log: a URL in it loses its credentials and its query, then clean()
 *
 * @param   {*}  text
 * @returns {String}
 */
// the URLs are scrubbed before clean() cuts the text, so a cut never leaves part of a password or token behind
const safeError = (text) =>
	clean(
		String(text ?? "")
			.replace(URL_USERINFO, "$<scheme>***@")
			.replace(URL_QUERY, "$<url>?***"),
	);

const textOrNull = (value) => (value === undefined || value === null ? null : String(value));

const parsePayload = (text) => {
	if (text === null || text === undefined) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

/**
 * @param   {Object}  options
 * @param   {Object}  options.knex
 * @param   {Object}  [options.clock]  { now() } in ms
 */
const createQueue = ({ knex, clock = { now: () => Date.now() } }) => {
	const table = () => knex(TABLE);
	// SQLite has no time type: UTC text that sorts as it compares. The MySQL and Postgres drivers take a Date.
	const sqlite = engineOf(knex) === "sqlite";
	const dbTime = (ms) => {
		const date = new Date(ms);
		return sqlite ? date.toISOString().replace("T", " ").slice(0, -1) : date;
	};

	/**
	 * Adds pending rows. A row: { message_id, event, channel, target_id?, recipient?, group_key?, payload, delay_ms? }
	 * where payload is an object or JSON text and delay_ms postpones the first try.
	 *
	 * @param   {Object[]}  rows
	 * @returns {Promise<number>}  the number of rows added
	 */
	const add = async (rows) => {
		const nowMs = clock.now();
		const now = dbTime(nowMs);
		const records = rows.map((row) => ({
			created_on: now,
			modified_on: now,
			message_id: row.message_id,
			event: row.event,
			channel: row.channel,
			target_id: row.target_id ?? null,
			recipient: row.recipient ?? null,
			group_key: row.group_key ?? null,
			payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload ?? null),
			status: "pending",
			attempts: 0,
			next_try_on: row.delay_ms > 0 ? dbTime(nowMs + row.delay_ms) : null,
		}));
		await knex.transaction(async (trx) => {
			for (const record of records) await trx(TABLE).insert(record);
		});
		return records.length;
	};

	/**
	 * Takes the due rows of a channel (pending, next_try_on empty or reached), oldest first, and sets them to sending.
	 * Rows with a group_key come with every other due row of the same key, even beyond the limit.
	 *
	 * @param   {Object}  options
	 * @param   {String}  options.channel
	 * @param   {Number}  [options.limit]
	 * @returns {Promise<Object[]>}  the rows, payload parsed
	 */
	const claimDue = async ({ channel, limit = 50 }) => {
		const now = dbTime(clock.now());
		const due = () =>
			table()
				.where({ channel, status: "pending" })
				.where((query) => query.whereNull("next_try_on").orWhere("next_try_on", "<=", now));
		const first = await due().orderBy("id").limit(limit);
		const keys = [...new Set(first.map((row) => row.group_key).filter((key) => key !== null))];
		const taken = new Map(first.map((row) => [row.id, row]));
		if (keys.length > 0) {
			const grouped = await due().whereIn("group_key", keys).orderBy("id");
			for (const row of grouped) taken.set(row.id, row);
		}
		const candidates = [...taken.values()].sort((left, right) => left.id - right.id);
		// each row is taken by its own conditional update: one that left pending meanwhile is never returned
		const rows = [];
		for (const row of candidates) {
			const count = await table()
				.where({ id: row.id, status: "pending" })
				.where((query) => query.whereNull("next_try_on").orWhere("next_try_on", "<=", now))
				.update({ status: "sending", modified_on: now });
			if (Number(count) === 1) rows.push(row);
		}
		return rows.map((row) => ({ ...row, status: "sending", payload: parsePayload(row.payload) }));
	};

	/**
	 * Records the outcome of sends. A success is sent (payload cleared). A retry waits max(retryDelays[attempts],
	 * retry_after_ms) while retryDelays has an entry for the attempt, else it is failed. A failure without retry is
	 * failed at once. attempts counts every try.
	 *
	 * @param   {Object[]}  results  [{ id, ok, retry, retry_after_ms, http_status, duration_ms, error, response }]
	 * @param   {Object}    options
	 * @param   {Number[]}  options.retryDelays
	 */
	const settle = async (results, { retryDelays = [] } = {}) => {
		const nowMs = clock.now();
		const now = dbTime(nowMs);
		for (const result of results) {
			const row = await table().select("attempts").where({ id: result.id, status: "sending" }).first();
			if (!row) continue;
			const attempts = Number(row.attempts) + 1;
			const changes = {
				attempts,
				modified_on: now,
				http_status: result.http_status ?? null,
				duration_ms: result.duration_ms === undefined ? null : Math.round(result.duration_ms),
				error: result.error ? safeError(result.error) : null,
				response: textOrNull(result.response)?.slice(0, MAX_RESPONSE) ?? null,
			};
			if (result.ok) {
				Object.assign(changes, { status: "sent", payload: null, next_try_on: null, error: null });
			} else if (result.retry && Number(row.attempts) < retryDelays.length) {
				const wait = Math.max(retryDelays[Number(row.attempts)], result.retry_after_ms ?? 0);
				Object.assign(changes, { status: "pending", next_try_on: dbTime(nowMs + wait) });
			} else {
				Object.assign(changes, { status: "failed", next_try_on: null });
			}
			await table().where({ id: result.id, status: "sending" }).update(changes);
		}
	};

	/** Puts the rows a stopped process left in sending back to pending (at start) */
	const resetSending = async () => {
		await table()
			.where({ status: "sending" })
			.update({ status: "pending", modified_on: dbTime(clock.now()) });
	};

	/** The pending rows of a deleted or disabled target are dropped (their payload is not needed any more) */
	const dropTarget = async (channel, targetId) => {
		await table()
			.where({ channel, target_id: targetId, status: "pending" })
			.update({ status: "dropped", payload: null, next_try_on: null, modified_on: dbTime(clock.now()) });
	};

	/** Removes mail rows in a final status that were last changed more than `days` days ago */
	const pruneMail = async (days) => {
		await table()
			.where({ channel: "mail" })
			.whereIn("status", FINAL)
			.where("modified_on", "<", dbTime(clock.now() - days * DAY_MS))
			.delete();
	};

	/** Removes the final rows of one webhook beyond its newest `keep` rows or older than `days` days */
	const pruneTarget = async (targetId, keep, days) => {
		const where = () => table().where({ channel: "webhook", target_id: targetId }).whereIn("status", FINAL);
		await where()
			.where("modified_on", "<", dbTime(clock.now() - days * DAY_MS))
			.delete();
		if (!(keep > 0)) {
			await where().delete();
			return;
		}
		const kept = await where().select("id").orderBy("id", "desc").limit(keep);
		if (kept.length < keep) return;
		await where().where("id", "<", kept.at(-1).id).delete();
	};

	/** Clears the payload of failed rows that failed more than `days` days ago */
	const clearOldPayloads = async (days) => {
		await table()
			.where({ status: "failed" })
			.whereNotNull("payload")
			.where("modified_on", "<", dbTime(clock.now() - days * DAY_MS))
			.update({ payload: null });
	};

	return { add, claimDue, clearOldPayloads, dropTarget, pruneMail, pruneTarget, resetSending, settle };
};

export { createQueue, safeError };
