import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createStateStore, MOVED_WATERMARK_KEY, objectPartOf } from "../lib/notify/state-store.js";
import { migratedSqlite } from "./support/database.js";

const TABLE = "npmpro_notification_state";
const HOUR = 3_600_000;
const START = Date.parse("2026-11-26T10:00:00Z");
const EXPIRING = "certificate.expiring";
const CONFIG = "host.config_error";
const NOT_STATE = /not a notification state/u;
const BROKEN = /broken/u;
const OBJECT_ID = /object id/u;
const KEPT_CHANGING = /kept changing/u;
const HASHED = /^sha256:[\w-]{43}$/u;
const PREFIX = /prefix/u;

let db;
const clock = { at: START, now: () => clock.at };
const storeOf = (options = {}) => createStateStore({ knex: db.knex, clock, reminderHours: () => 24, ...options });
const rows = () => db.knex(TABLE).orderBy("id");

before(async () => {
	db = await migratedSqlite();
});
beforeEach(async () => {
	clock.at = START;
	await db.knex(TABLE).delete();
});
after(() => db.cleanup());

describe("report", () => {
	it("stores a first ok silently", async () => {
		const store = storeOf();
		assert.equal(await store.report({ event: EXPIRING, objectId: 1, state: "ok", data: { id: 1 } }), null);
		const [row] = await rows();
		assert.equal(row.key, "certificate.expiring:1");
		assert.equal(row.event, EXPIRING);
		assert.equal(row.object_id, "1");
		assert.equal(row.state, "ok");
		assert.equal(row.since, "2026-11-26 10:00:00.000");
		assert.equal(row.last_sent_on, null);
		assert.deepEqual(JSON.parse(row.data), { id: 1 });
	});

	it("sends a first bad", async () => {
		const store = storeOf();
		const data = { id: 1, state: "soon", days_left: 5 };
		assert.deepEqual(await store.report({ event: EXPIRING, objectId: 1, state: "soon", data }), {
			type: EXPIRING,
			data,
		});
		const [row] = await rows();
		assert.equal(row.state, "soon");
		assert.equal(row.last_sent_on, "2026-11-26 10:00:00.000");
	});

	it("writes nothing for ok after ok", async () => {
		const store = storeOf();
		await store.report({ event: EXPIRING, objectId: 1, state: "ok", data: { id: 1 } });
		clock.at += HOUR;
		assert.equal(await store.report({ event: EXPIRING, objectId: 1, state: "ok", data: { id: 1, x: 2 } }), null);
		const [row] = await rows();
		assert.equal(row.since, "2026-11-26 10:00:00.000");
		assert.deepEqual(JSON.parse(row.data), { id: 1 });
	});

	it("sends ok to bad and stores the change", async () => {
		const store = storeOf();
		await store.report({ event: EXPIRING, objectId: 1, state: "ok", data: { id: 1 } });
		clock.at += HOUR;
		const data = { id: 1, state: "soon" };
		assert.deepEqual(await store.report({ event: EXPIRING, objectId: 1, state: "soon", data }), {
			type: EXPIRING,
			data,
		});
		const [row] = await rows();
		assert.equal(row.state, "soon");
		assert.equal(row.since, "2026-11-26 11:00:00.000");
		assert.equal(row.last_sent_on, "2026-11-26 11:00:00.000");
		assert.deepEqual(JSON.parse(row.data), data);
	});

	it("sends the same bad value once and keeps its newest data", async () => {
		const store = storeOf();
		assert.ok(await store.report({ event: EXPIRING, objectId: 1, state: "soon", data: { days_left: 5 } }));
		clock.at += HOUR;
		assert.equal(await store.report({ event: EXPIRING, objectId: 1, state: "soon", data: { days_left: 4 } }), null);
		const [row] = await rows();
		assert.deepEqual(JSON.parse(row.data), { days_left: 4 });
		assert.equal(row.since, "2026-11-26 10:00:00.000");
		assert.equal(row.last_sent_on, "2026-11-26 10:00:00.000");
	});

	it("sends soon and then expired", async () => {
		const store = storeOf();
		const first = await store.report({ event: EXPIRING, objectId: 1, state: "soon", data: { state: "soon" } });
		clock.at += 5 * 24 * HOUR;
		const second = await store.report({
			event: EXPIRING,
			objectId: 1,
			state: "expired",
			data: { state: "expired" },
		});
		assert.deepEqual(first, { type: EXPIRING, data: { state: "soon" } });
		assert.deepEqual(second, { type: EXPIRING, data: { state: "expired" } });
		const [row] = await rows();
		assert.equal(row.state, "expired");
		assert.equal(row.since, "2026-12-01 10:00:00.000");
	});

	it("sends .resolved with the new data when bad turns ok", async () => {
		const store = storeOf();
		await store.report({ event: CONFIG, objectId: "proxy_host:12", state: "bad", data: { error: "x" } });
		clock.at += HOUR;
		assert.deepEqual(
			await store.report({ event: CONFIG, objectId: "proxy_host:12", state: "ok", data: { id: 12 } }),
			{
				type: "host.config_error.resolved",
				data: { id: 12 },
			},
		);
		const [row] = await rows();
		assert.equal(row.state, "ok");
		assert.equal(row.since, "2026-11-26 11:00:00.000");
		assert.equal(await store.report({ event: CONFIG, objectId: "proxy_host:12", state: "ok", data: {} }), null);
	});

	it("repeats nothing after a restart: a new store over the same rows", async () => {
		const first = storeOf();
		await first.report({ event: EXPIRING, objectId: 1, state: "ok", data: {} });
		await first.report({ event: EXPIRING, objectId: 2, state: "soon", data: {} });
		await first.report({ event: CONFIG, objectId: "stream:3", state: "bad", data: {} });
		clock.at += HOUR;
		const second = storeOf();
		assert.equal(await second.report({ event: EXPIRING, objectId: 1, state: "ok", data: {} }), null);
		assert.equal(await second.report({ event: EXPIRING, objectId: 2, state: "soon", data: {} }), null);
		assert.equal(await second.report({ event: CONFIG, objectId: "stream:3", state: "bad", data: {} }), null);
		assert.equal((await rows()).length, 3);
	});

	it("sends one event for concurrent reports of one key on one store", async () => {
		const store = storeOf();
		const results = await Promise.all(
			Array.from({ length: 5 }, () => store.report({ event: EXPIRING, objectId: 7, state: "soon", data: {} })),
		);
		assert.equal(results.filter(Boolean).length, 1);
		assert.equal((await rows()).length, 1);
	});

	it("sends one event when two stores insert the same key at once (the unique key decides)", async () => {
		const [a, b] = [storeOf(), storeOf()];
		const results = await Promise.all([
			a.report({ event: EXPIRING, objectId: 8, state: "soon", data: {} }),
			b.report({ event: EXPIRING, objectId: 8, state: "soon", data: {} }),
		]);
		assert.equal(results.filter(Boolean).length, 1);
		assert.equal((await rows()).length, 1);
	});

	it("sends one event when two stores change the same row at once", async () => {
		const [a, b] = [storeOf(), storeOf()];
		await a.report({ event: EXPIRING, objectId: 9, state: "ok", data: {} });
		const results = await Promise.all([
			a.report({ event: EXPIRING, objectId: 9, state: "expired", data: {} }),
			b.report({ event: EXPIRING, objectId: 9, state: "expired", data: {} }),
		]);
		assert.equal(results.filter(Boolean).length, 1);
	});

	it("refuses an unknown event, a resolved event, an unknown state and an empty object id", async () => {
		const store = storeOf();
		await assert.rejects(store.report({ event: "host.created", objectId: 1, state: "bad" }), NOT_STATE);
		await assert.rejects(store.report({ event: `${EXPIRING}.resolved`, objectId: 1, state: "bad" }));
		await assert.rejects(store.report({ event: EXPIRING, objectId: 1, state: "broken" }), BROKEN);
		await assert.rejects(store.report({ event: EXPIRING, objectId: "", state: "ok" }), OBJECT_ID);
		await assert.rejects(store.report({ event: EXPIRING, state: "ok" }), OBJECT_ID);
	});

	it("passes on a database error", async () => {
		const store = storeOf();
		await db.knex.schema.renameTable(TABLE, `${TABLE}_away`);
		try {
			await assert.rejects(store.report({ event: EXPIRING, objectId: 1, state: "bad", data: {} }));
		} finally {
			await db.knex.schema.renameTable(`${TABLE}_away`, TABLE);
		}
		assert.equal((await store.report({ event: EXPIRING, objectId: 1, state: "bad", data: {} })) !== null, true);
	});

	it("gives up on a key that keeps changing", async () => {
		// a knex whose insert always meets the unique key and whose read never finds the row
		const fake = Object.assign(
			() => {
				const chain = {
					select: () => chain,
					where: () => chain,
					first: () => Promise.resolve(undefined),
					insert: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
				};
				return chain;
			},
			{ client: { config: { client: "pg" } } },
		);
		const store = createStateStore({ knex: fake, clock });
		await assert.rejects(store.report({ event: EXPIRING, objectId: 1, state: "bad" }), KEPT_CHANGING);
	});

	it("hashes an object id longer than 64 characters and still finds its state", async () => {
		const store = storeOf();
		const objectId = "x".repeat(300);
		assert.ok(await store.report({ event: CONFIG, objectId, state: "bad", data: {} }));
		const [row] = await rows();
		assert.equal(row.object_id, objectPartOf(objectId));
		assert.match(row.object_id, HASHED);
		assert.ok(row.key.length <= 191);
		assert.equal(await store.report({ event: CONFIG, objectId, state: "bad", data: {} }), null);
		assert.equal(
			(await store.report({ event: CONFIG, objectId, state: "ok", data: {} })).type,
			`${CONFIG}.resolved`,
		);
		await store.removeMissing(CONFIG, [objectId]);
		assert.equal((await rows()).length, 1);
		await store.clear(CONFIG, objectId);
		assert.equal((await rows()).length, 0);
	});

	it("keeps an object id of exactly 64 characters as it is", () => {
		assert.equal(objectPartOf("y".repeat(64)), "y".repeat(64));
		assert.equal(objectPartOf(12), "12");
	});
});

describe("reminders", () => {
	const bad = async (store, objectId = 1) =>
		store.report({ event: EXPIRING, objectId, state: "soon", data: { id: objectId } });

	it("sends one reminder after 24 hours, none before and none again within the interval", async () => {
		const store = storeOf();
		await bad(store);
		await store.report({ event: EXPIRING, objectId: 2, state: "ok", data: {} });
		clock.at += 23 * HOUR;
		assert.deepEqual(await store.dueReminders(), []);
		clock.at += HOUR;
		assert.deepEqual(await store.dueReminders(), [{ type: EXPIRING, data: { id: 1, reminder: true } }]);
		assert.deepEqual(await store.dueReminders(), []);
		clock.at += 23 * HOUR;
		assert.deepEqual(await store.dueReminders(), []);
		clock.at += HOUR;
		assert.equal((await store.dueReminders()).length, 1);
		const [row] = await rows();
		assert.equal(row.last_sent_on, "2026-11-28 10:00:00.000");
	});

	it("counts from the last change, not from the first bad", async () => {
		const store = storeOf();
		await bad(store);
		clock.at += 20 * HOUR;
		await store.report({ event: EXPIRING, objectId: 1, state: "expired", data: { id: 1 } });
		clock.at += 4 * HOUR;
		assert.deepEqual(await store.dueReminders(), []);
	});

	it("sends no reminder when the hours are 0, and reads the hours on every sweep", async () => {
		let hours = 0;
		const store = storeOf({ reminderHours: async () => hours });
		await bad(store);
		clock.at += 1000 * HOUR;
		assert.deepEqual(await store.dueReminders(), []);
		hours = 168;
		assert.equal((await store.dueReminders()).length, 1);
	});

	it("survives data that is not an object", async () => {
		const store = storeOf();
		await bad(store);
		await db.knex(TABLE).update({ data: "not json" });
		await bad(store, 3);
		await db.knex(TABLE).where({ object_id: "3" }).update({ data: null });
		clock.at += 24 * HOUR;
		assert.deepEqual(
			(await store.dueReminders()).map((reminder) => reminder.data),
			[{ reminder: true }, { reminder: true }],
		);
	});

	it("sends one reminder when two sweeps run at once", async () => {
		const [a, b] = [storeOf(), storeOf()];
		await bad(a);
		clock.at += 24 * HOUR;
		const [first, second] = await Promise.all([a.dueReminders(), b.dueReminders()]);
		assert.equal(first.length + second.length, 1);
	});
});

describe("clearing and pruning", () => {
	it("clear removes the state without an event", async () => {
		const store = storeOf();
		await store.report({ event: EXPIRING, objectId: 1, state: "soon", data: {} });
		await store.report({ event: EXPIRING, objectId: 2, state: "soon", data: {} });
		await store.clear(EXPIRING, 1);
		assert.deepEqual(
			(await rows()).map((row) => row.object_id),
			["2"],
		);
		// gone: the next bad is a first observation again
		assert.ok(await store.report({ event: EXPIRING, objectId: 1, state: "soon", data: {} }));
	});

	it("clearMatching removes proxy_host:12 and its sub-objects, not proxy_host:120 or other events", async () => {
		const store = storeOf();
		for (const objectId of ["proxy_host:12", "proxy_host:12:a", "proxy_host:120", "proxyxhost:12", "stream:12"]) {
			await store.report({ event: CONFIG, objectId, state: "bad", data: {} });
		}
		await store.report({ event: "ddns.record_failed", objectId: "proxy_host:12", state: "bad", data: {} });
		await store.clearMatching(CONFIG, "proxy_host:12");
		assert.deepEqual(
			(await rows()).map((row) => row.key),
			[
				"host.config_error:proxy_host:120",
				"host.config_error:proxyxhost:12",
				"host.config_error:stream:12",
				"ddns.record_failed:proxy_host:12",
			],
		);
		await store.clearMatching(CONFIG, "proxy_%");
		assert.equal((await rows()).length, 4);
		await assert.rejects(store.clearMatching(CONFIG, ""), PREFIX);
	});

	it("removeMissing keeps only the listed objects of the event", async () => {
		const store = storeOf();
		for (const objectId of [1, 2, 3]) await store.report({ event: EXPIRING, objectId, state: "soon", data: {} });
		await store.report({ event: "certificate.renewal_failed", objectId: 3, state: "bad", data: {} });
		await store.removeMissing(EXPIRING, [2, "3", 99]);
		assert.deepEqual(
			(await rows()).map((row) => row.key),
			["certificate.expiring:2", "certificate.expiring:3", "certificate.renewal_failed:3"],
		);
		await store.removeMissing("certificate.renewal_failed", new Set());
		assert.equal((await rows()).length, 2);
	});

	it("removeMissing removes many rows in chunks", async () => {
		const store = storeOf();
		const many = Array.from({ length: 1203 }, (_, index) => ({
			key: `${EXPIRING}:${index}`,
			event: EXPIRING,
			object_id: String(index),
			state: "ok",
			since: "2026-11-26 10:00:00.000",
		}));
		for (let at = 0; at < many.length; at += 100) await db.knex(TABLE).insert(many.slice(at, at + 100));
		await store.removeMissing(EXPIRING, [5]);
		assert.deepEqual(
			(await rows()).map((row) => row.object_id),
			["5"],
		);
	});

	it("prune removes ok states older than 30 days and keeps bad and young ok states", async () => {
		const store = storeOf();
		await store.report({ event: EXPIRING, objectId: 1, state: "ok", data: {} });
		await store.report({ event: EXPIRING, objectId: 2, state: "soon", data: {} });
		clock.at += 10 * 24 * HOUR;
		await store.report({ event: EXPIRING, objectId: 3, state: "ok", data: {} });
		clock.at += 20 * 24 * HOUR + 1000;
		await store.prune();
		assert.deepEqual(
			(await rows()).map((row) => row.object_id),
			["2", "3"],
		);
	});

	it("prune never drops the database move watermark, however old", async () => {
		await db.knex(TABLE).insert({
			key: MOVED_WATERMARK_KEY,
			event: "database.moved",
			object_id: "audit",
			state: "ok",
			since: "2000-01-01 00:00:00.000",
			data: "{}",
		});
		await storeOf().prune();
		assert.deepEqual(
			(await rows()).map((row) => row.key),
			[MOVED_WATERMARK_KEY],
		);
	});
});
