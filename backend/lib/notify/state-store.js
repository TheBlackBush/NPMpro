import { createHash } from "node:crypto";
import { createKeyedLock } from "../keyed-lock.js";
import { resolvedOf, stateEvents } from "./catalogue.js";
import { dbTimeOf } from "./db-time.js";

// The last known state of every state event and its object, in npmpro_notification_state. An event goes out only on
// a change of the stored state, so a restart (a new store over the same rows) repeats nothing. Reports of one key run
// one after another (the keyed lock); every write is still conditional on the state it was decided from, and an
// insert that meets the unique key of another writer reads the row again, so two writers never send one change twice.

const TABLE = "npmpro_notification_state";
// the watermark of the database move check (internal/notify.js): an ok row the prune never drops
const MOVED_WATERMARK_KEY = "database.moved:audit";
const OK = "ok";
const BAD_STATES = new Set(["bad", "soon", "expired"]);
const STATE_IDS = new Set(stateEvents().map((entry) => entry.id));
// the object_id column; a longer id is stored as its hash (the key then stays far below its 191 characters)
const MAX_OBJECT_ID = 64;
const HOUR_MS = 3_600_000;
const PRUNE_OK_DAYS = 30;
const DAY_MS = 24 * HOUR_MS;
const ATTEMPTS = 3;
const DELETE_CHUNK = 500;
// SQLite (better-sqlite3 and sqlite3) constraint codes, MySQL ER_DUP_ENTRY, Postgres 23505
const UNIQUE_CODES = new Set(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY", "ER_DUP_ENTRY", "23505"]);
const LIKE_SPECIAL = /[!%_]/gu;

/**
 * The object part of a key: the id as text, or "sha256:" and the base64url SHA-256 of an id longer than 64 characters
 *
 * @param   {String|Number} objectId
 * @returns {String}
 */
const objectPartOf = (objectId) => {
	const id = String(objectId ?? "");
	if (id === "") throw new Error("A notification state needs an object id");
	if (id.length <= MAX_OBJECT_ID) return id;
	return `sha256:${createHash("sha256").update(id).digest("base64url")}`;
};

const keyOf = (event, objectPart) => `${event}:${objectPart}`;

const assertEvent = (event) => {
	if (!STATE_IDS.has(event)) throw new Error(`${event} is not a notification state event`);
};

const isUniqueViolation = (error) => UNIQUE_CODES.has(error?.code);

const parseData = (text) => {
	try {
		const data = JSON.parse(text ?? "{}");
		return data && typeof data === "object" && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
};

/**
 * @param   {Object}    options
 * @param   {Object}    options.knex
 * @param   {Object}    [options.clock]          { now() } in ms
 * @param   {Function}  [options.reminderHours]  () => hours between reminders (0 to 168, 0: none), or a Promise of it
 */
const createStateStore = ({ knex, clock = { now: () => Date.now() }, reminderHours = () => 24 }) => {
	const lock = createKeyedLock();
	const table = () => knex(TABLE);
	// the convention of the other tables (db-time.js): naive local text on SQLite, a Date for MySQL and Postgres
	const dbTime = dbTimeOf(knex);

	const insertRow = async ({ key, event, objectPart, state, json, now }) => {
		try {
			await table().insert({
				key,
				event,
				object_id: objectPart,
				state,
				since: now,
				last_sent_on: state === OK ? null : now,
				data: json,
			});
			return true;
		} catch (error) {
			if (isUniqueViolation(error)) return false;
			throw error;
		}
	};

	// one pass of the decision; undefined when another writer changed the row in between (decide again)
	const decide = async ({ key, event, objectPart, state, data, json }) => {
		const row = await table().select("state", "data").where({ key }).first();
		const now = dbTime(clock.now());
		if (!row) {
			if (!(await insertRow({ key, event, objectPart, state, json, now }))) return;
			return state === OK ? null : { type: event, data };
		}
		if (row.state === state) {
			if (state !== OK && row.data !== json) await table().where({ key, state }).update({ data: json });
			return null;
		}
		const changes =
			state === OK ? { state, since: now, data: json } : { state, since: now, data: json, last_sent_on: now };
		const count = await table().where({ key, state: row.state }).update(changes);
		if (Number(count) !== 1) return;
		return { type: state === OK ? resolvedOf(event) : event, data };
	};

	/**
	 * Stores the state of an object and says which event that change sends
	 *
	 * @param   {Object}         report
	 * @param   {String}         report.event     a state event of the catalogue
	 * @param   {String|Number}  report.objectId
	 * @param   {String}         report.state     ok, bad, soon or expired
	 * @param   {Object}         [report.data]    the whitelisted data (buildData)
	 * @returns {Promise<{type: String, data: Object}|null>}
	 */
	const report = async ({ event, objectId, state, data = {} }) => {
		assertEvent(event);
		if (state !== OK && !BAD_STATES.has(state)) throw new Error(`${state} is not a notification state`);
		const objectPart = objectPartOf(objectId);
		const key = keyOf(event, objectPart);
		const json = JSON.stringify(data);
		const sent = await lock(key, async () => {
			for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
				const result = await decide({ key, event, objectPart, state, data, json });
				if (result !== undefined) return result;
			}
			throw new Error(`The notification state ${key} kept changing`);
		});
		return sent;
	};

	/** Removes the state of one object without an event (the object was deleted) */
	const clear = async (event, objectId) => {
		assertEvent(event);
		const key = keyOf(event, objectPartOf(objectId));
		await lock(key, () => table().where({ key }).delete());
	};

	/**
	 * Removes, without an event, the states whose object is the prefix or starts with it and a colon: proxy_host:12
	 * matches proxy_host:12 and proxy_host:12:x, never proxy_host:120. A hashed (longer than 64 characters) id never
	 * matches.
	 */
	const clearMatching = async (event, objectIdPrefix) => {
		assertEvent(event);
		const prefix = String(objectIdPrefix ?? "");
		if (prefix === "") throw new Error("clearMatching needs a prefix");
		const pattern = `${prefix.replace(LIKE_SPECIAL, (char) => `!${char}`)}:%`;
		await table()
			.where({ event })
			.where((query) =>
				query.where({ object_id: prefix }).orWhereRaw("?? like ? escape '!'", ["object_id", pattern]),
			)
			.delete();
	};

	/** Removes, without an event, the states of the objects not in the list (after a restore) */
	const removeMissing = async (event, keepObjectIds) => {
		assertEvent(event);
		const keep = new Set([...keepObjectIds].map((id) => objectPartOf(id)));
		const rows = await table().select("key", "object_id").where({ event });
		const gone = rows.filter((row) => !keep.has(row.object_id)).map((row) => row.key);
		for (let at = 0; at < gone.length; at += DELETE_CHUNK) {
			await table()
				.whereIn("key", gone.slice(at, at + DELETE_CHUNK))
				.delete();
		}
	};

	/**
	 * The reminders that are due: states still bad whose last event is at least reminderHours old. Each is marked
	 * sent, so a second sweep within the interval returns none.
	 *
	 * @returns {Promise<{type: String, data: Object}[]>}
	 */
	const dueReminders = async () => {
		const hours = Number(await reminderHours());
		if (!(hours > 0)) return [];
		const nowMs = clock.now();
		const cutoff = dbTime(nowMs - hours * HOUR_MS);
		const due = (query) => query.whereNull("last_sent_on").orWhere("last_sent_on", "<=", cutoff);
		const rows = await table()
			.select("key", "event", "state", "data")
			.whereNot({ state: OK })
			.where(due)
			.orderBy("id");
		const reminders = [];
		for (const row of rows) {
			const count = await lock(row.key, () =>
				table()
					.where({ key: row.key, state: row.state })
					.where(due)
					.update({ last_sent_on: dbTime(nowMs) }),
			);
			if (Number(count) === 1)
				reminders.push({ type: row.event, data: { ...parseData(row.data), reminder: true } });
		}
		return reminders;
	};

	/** Removes the ok states that began more than 30 days ago */
	const prune = async () => {
		await table()
			.where({ state: OK })
			.whereNot({ key: MOVED_WATERMARK_KEY })
			.where("since", "<", dbTime(clock.now() - PRUNE_OK_DAYS * DAY_MS))
			.delete();
	};

	return { clear, clearMatching, dueReminders, prune, removeMissing, report };
};

export { createStateStore, MOVED_WATERMARK_KEY, objectPartOf };
