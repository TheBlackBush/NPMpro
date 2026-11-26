import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { migratedSqlite } from "./support/database.js";

// The notification layer under a server time zone that is not UTC: the stored times follow the database's convention
// (naive local text on SQLite) and an event's dates are the real instants. Set before any date code runs.
process.env.TZ = "Pacific/Auckland";

const STATE = "npmpro_notification_state";
const DELIVERY = "npmpro_notification_delivery";
const SECOND = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 23:00 in Auckland (+13:00 in November)
const START = Date.parse("2026-11-26T10:00:00Z");
const LOCAL_START = "2026-11-26 23:00:00";

let db;
let createQueue;
let createStateStore;
let buildData;
let localToIso;
let msOfDbTime;
const clock = { at: START, now: () => clock.at };

before(async () => {
	({ createQueue } = await import("../lib/notify/queue.js"));
	({ createStateStore } = await import("../lib/notify/state-store.js"));
	({ buildData } = await import("../lib/notify/catalogue.js"));
	({ localToIso } = await import("../lib/backup/rows.js"));
	({ msOfDbTime } = await import("../lib/notify/db-time.js"));
	db = await migratedSqlite();
});
beforeEach(async () => {
	clock.at = START;
	await db.knex(STATE).delete();
	await db.knex(DELIVERY).delete();
});
after(() => db.cleanup());

describe("notification times under a non-UTC time zone", () => {
	it("the zone is in effect for the process and for SQLite's localtime", async () => {
		assert.equal(new Date(START).getHours(), 23);
		const [{ now }] = await db.knex.raw("select datetime('now','localtime') as now");
		assert.ok(Math.abs(Date.parse(now.replace(" ", "T")) - Date.now()) < 5 * SECOND);
	});

	it("an event's expires_on is the real instant of the stored local date", async () => {
		const store = createStateStore({ knex: db.knex, clock });
		const data = buildData("certificate.expiring", { id: 4, expires_on: LOCAL_START, state: "soon" });
		assert.equal(data.expires_on, "2026-11-26T10:00:00.000Z");
		const change = await store.report({ event: "certificate.expiring", objectId: 4, state: "soon", data });
		assert.equal(change.data.expires_on, "2026-11-26T10:00:00.000Z");
		assert.equal(
			buildData("certificate.issued", { expires_on: LOCAL_START }).expires_on,
			"2026-11-26T10:00:00.000Z",
		);
	});

	it("a state's times are local text, and a reminder is due 24 hours after the last event, not 13 hours off", async () => {
		const store = createStateStore({ knex: db.knex, clock, reminderHours: () => 24 });
		await store.report({ event: "geoip.failed", objectId: "geoip", state: "bad", data: {} });
		const row = await db.knex(STATE).first();
		assert.equal(row.since, LOCAL_START);
		assert.equal(row.last_sent_on, LOCAL_START);
		assert.equal(localToIso(row.since), new Date(START).toISOString());
		clock.at = START + DAY - SECOND;
		assert.deepEqual(await store.dueReminders(), []);
		clock.at = START + DAY;
		assert.equal((await store.dueReminders()).length, 1);
	});

	it("prune drops an ok state 30 days after it began, at the real cutoff", async () => {
		const store = createStateStore({ knex: db.knex, clock });
		await store.report({ event: "geoip.failed", objectId: "geoip", state: "ok", data: {} });
		clock.at = START + 30 * DAY;
		await store.prune();
		assert.equal((await db.knex(STATE)).length, 1);
		clock.at = START + 30 * DAY + SECOND;
		await store.prune();
		assert.equal((await db.knex(STATE)).length, 0);
	});

	it("a delivery's next try is local text and is due at the real instant", async () => {
		const queue = createQueue({ knex: db.knex, clock });
		await queue.add([
			{
				message_id: "msg_a",
				event: "host.created",
				channel: "webhook",
				target_id: 1,
				payload: {},
				delay_ms: 60 * SECOND,
			},
		]);
		const row = await db.knex(DELIVERY).first();
		assert.equal(row.created_on, LOCAL_START);
		assert.equal(row.next_try_on, "2026-11-26 23:01:00");
		assert.equal(msOfDbTime(row.next_try_on), START + 60 * SECOND);
		clock.at = START + 59 * SECOND;
		assert.deepEqual(await queue.claimDue({ channel: "webhook" }), []);
		clock.at = START + 60 * SECOND;
		assert.equal((await queue.claimDue({ channel: "webhook" })).length, 1);
	});

	it("a time column is read back as local time, a Date or zoned text as it is", () => {
		assert.equal(msOfDbTime(LOCAL_START), START);
		assert.equal(msOfDbTime(new Date(START)), START);
		assert.equal(msOfDbTime("2026-11-26T10:00:00Z"), START);
		assert.ok(Number.isNaN(msOfDbTime(null)));
	});
});
