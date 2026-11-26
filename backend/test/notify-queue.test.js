import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { isoToLocal } from "../lib/backup/rows.js";
import { createNotify } from "../lib/notify/index.js";
import { createQueue } from "../lib/notify/queue.js";
import { createStateStore } from "../lib/notify/state-store.js";
import { createWorker } from "../lib/notify/worker.js";
import { migratedSqlite } from "./support/database.js";

const TABLE = "npmpro_notification_delivery";
const STATE = "npmpro_notification_state";
const MINUTE = 60_000;
const DAY = 24 * 3_600_000;
const START = Date.parse("2026-11-26T10:00:00Z");
const PASSWORD = "hunter2";
const TOKEN = "abc123";
const DELAYS = [60_000, 300_000];
const WRITER_RUNNING = /writer-running|still running/u;
const NOT_EVENT = /not a notification event/u;
const MESSAGE_ID = /^msg_[a-z2-7]{26}$/u;

let db;
const clock = { at: START, now: () => clock.at };
const rows = () => db.knex(TABLE).orderBy("id");
const queueOf = () => createQueue({ knex: db.knex, clock });
// the stored form of a time on SQLite: naive local text, whole seconds (lib/notify/db-time.js)
const sql = (ms) => isoToLocal(new Date(ms).toISOString());
const row = (extra = {}) => ({
	message_id: "msg_a",
	event: "host.created",
	channel: "webhook",
	payload: { hello: "world" },
	...extra,
});
const taking = () => db.knex(TABLE).update({ status: "sending" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logOf = () => {
	const lines = [];
	return { lines, warn: (line) => lines.push(`warn ${line}`), debug: (line) => lines.push(`debug ${line}`) };
};

const channelOf = (id, extra = {}) => {
	const sent = [];
	return {
		id,
		sent,
		retryDelays: DELAYS,
		accepts: () => true,
		targets: async () => [{ target_id: id === "webhook" ? 1 : undefined }],
		send: (list) => {
			sent.push(list);
			return Promise.resolve(list.map((one) => ({ id: one.id, ok: true })));
		},
		...extra,
	};
};

before(async () => {
	db = await migratedSqlite();
});
beforeEach(async () => {
	clock.at = START;
	await db.knex(TABLE).delete();
	await db.knex.raw("delete from sqlite_sequence where name = ?", [TABLE]);
	await db.knex(STATE).delete();
});
after(() => db.cleanup());

describe("queue", () => {
	it("adds pending rows, a delay sets next_try_on", async () => {
		const queue = queueOf();
		assert.equal(await queue.add([row(), row({ delay_ms: MINUTE, group_key: "alerts:a@b.c" })]), 2);
		const [first, second] = await rows();
		assert.equal(first.status, "pending");
		assert.equal(first.attempts, 0);
		assert.equal(first.next_try_on, null);
		assert.equal(first.payload, '{"hello":"world"}');
		assert.equal(second.next_try_on, sql(START + MINUTE));
		assert.equal(second.group_key, "alerts:a@b.c");
	});

	it("claims due rows only, oldest first, and sets them to sending", async () => {
		const queue = queueOf();
		await queue.add([
			row({ message_id: "1" }),
			row({ message_id: "2", delay_ms: MINUTE }),
			row({ message_id: "3" }),
		]);
		const claimed = await queue.claimDue({ channel: "webhook", limit: 10 });
		assert.deepEqual(
			claimed.map((one) => one.message_id),
			["1", "3"],
		);
		assert.deepEqual(claimed[0].payload, { hello: "world" });
		assert.deepEqual(
			(await rows()).map((one) => one.status),
			["sending", "pending", "sending"],
		);
		assert.deepEqual(await queue.claimDue({ channel: "webhook" }), []);
		clock.at += MINUTE;
		assert.equal((await queue.claimDue({ channel: "webhook" })).length, 1);
	});

	it("gives a row of a waiting group the group's time, and leaves other rows alone", async () => {
		const queue = queueOf();
		await queue.add([row({ message_id: "1", group_key: "g", delay_ms: MINUTE })]);
		clock.at += 30_000;
		await queue.add([
			row({ message_id: "2", group_key: "g", delay_ms: MINUTE }),
			row({ message_id: "3", delay_ms: MINUTE }),
			row({ message_id: "4", group_key: "other", delay_ms: MINUTE }),
		]);
		const times = Object.fromEntries((await rows()).map((one) => [one.message_id, one.next_try_on]));
		assert.equal(times["2"], times["1"]);
		assert.equal(times["3"], sql(clock.at + MINUTE));
		assert.equal(times["4"], sql(clock.at + MINUTE));
		await db.knex(TABLE).where({ message_id: "1" }).update({ next_try_on: null });
		await queue.add([row({ message_id: "5", group_key: "g", delay_ms: MINUTE })]);
		assert.equal((await rows()).find((one) => one.message_id === "5").next_try_on, null);
	});

	it("does not make a new row of a group in a retry wait wait for it", async () => {
		const queue = queueOf();
		await queue.add([row({ message_id: "1", group_key: "g" })]);
		await queue.claimDue({ channel: "webhook" });
		await queue.settle([{ id: (await rows())[0].id, ok: false, retry: true }], { retryDelays: [6 * 3_600_000] });
		clock.at += 30_000;
		await queue.add([row({ message_id: "2", group_key: "g", delay_ms: MINUTE })]);
		const times = Object.fromEntries((await rows()).map((one) => [one.message_id, one.next_try_on]));
		assert.equal(times["1"], sql(clock.at - 30_000 + 6 * 3_600_000));
		assert.equal(times["2"], sql(clock.at + MINUTE));
	});

	it("claims only the channel asked for and honours the limit", async () => {
		const queue = queueOf();
		await queue.add([row(), row(), row({ channel: "mail" })]);
		assert.equal((await queue.claimDue({ channel: "webhook", limit: 1 })).length, 1);
		assert.equal((await queue.claimDue({ channel: "mail" })).length, 1);
	});

	it("takes the rows of a due group together, beyond the limit", async () => {
		const queue = queueOf();
		const group = { channel: "mail", group_key: "alerts:a@b.c" };
		await queue.add([
			row(group),
			row(group),
			row({ channel: "mail" }),
			row(group),
			row({ ...group, group_key: "x" }),
		]);
		const claimed = await queue.claimDue({ channel: "mail", limit: 1 });
		assert.deepEqual(
			claimed.map((one) => one.id),
			[1, 2, 4],
		);
	});

	it("leaves a group whose rows are not due", async () => {
		const queue = queueOf();
		await queue.add([row({ channel: "mail", group_key: "g", delay_ms: MINUTE })]);
		assert.deepEqual(await queue.claimDue({ channel: "mail" }), []);
	});

	it("keeps an unreadable payload as null", async () => {
		const queue = queueOf();
		await queue.add([row({ payload: "{not json" })]);
		const [claimed] = await queue.claimDue({ channel: "webhook" });
		assert.equal(claimed.payload, null);
	});

	it("settle: success is sent, payload cleared, attempts + 1", async () => {
		const queue = queueOf();
		await queue.add([row()]);
		await queue.claimDue({ channel: "webhook" });
		await taking();
		await queue.settle([{ id: 1, ok: true, http_status: 200, duration_ms: 12.4, response: "ok" }], {
			retryDelays: DELAYS,
		});
		const [done] = await rows();
		assert.equal(done.status, "sent");
		assert.equal(done.payload, null);
		assert.equal(done.attempts, 1);
		assert.equal(done.http_status, 200);
		assert.equal(done.duration_ms, 12);
		assert.equal(done.response, "ok");
	});

	it("settle: retries on the schedule, then fails and keeps the payload", async () => {
		const queue = queueOf();
		await queue.add([row()]);
		const fail = { id: 1, ok: false, retry: true, error: "boom" };
		await taking();
		await queue.settle([fail], { retryDelays: DELAYS });
		let [current] = await rows();
		assert.equal(current.status, "pending");
		assert.equal(current.attempts, 1);
		assert.equal(current.next_try_on, sql(START + 60_000));
		assert.equal(current.error, "boom");
		await taking();
		await queue.settle([fail], { retryDelays: DELAYS });
		[current] = await rows();
		assert.equal(current.status, "pending");
		assert.equal(current.attempts, 2);
		assert.equal(current.next_try_on, sql(START + 300_000));
		await taking();
		await queue.settle([fail], { retryDelays: DELAYS });
		[current] = await rows();
		assert.equal(current.status, "failed");
		assert.equal(current.attempts, 3);
		assert.equal(current.next_try_on, null);
		assert.equal(current.payload, '{"hello":"world"}');
	});

	it("settle: a later retry_after_ms wins over the schedule, an earlier one does not", async () => {
		const queue = queueOf();
		await queue.add([row(), row()]);
		await taking();
		await queue.settle(
			[
				{ id: 1, ok: false, retry: true, retry_after_ms: 600_000 },
				{ id: 2, ok: false, retry: true, retry_after_ms: 1000 },
			],
			{ retryDelays: DELAYS },
		);
		const [late, soon] = await rows();
		assert.equal(late.next_try_on, sql(START + 600_000));
		assert.equal(soon.next_try_on, sql(START + 60_000));
	});

	it("settle: a failure without retry is failed at once, the error cleaned and cut", async () => {
		const queue = queueOf();
		await queue.add([row()]);
		await taking();
		await queue.settle([{ id: 1, ok: false, error: `bad\nline ${"x".repeat(400)}`, response: "r".repeat(3000) }], {
			retryDelays: DELAYS,
		});
		const [failed] = await rows();
		assert.equal(failed.status, "failed");
		assert.equal(failed.attempts, 1);
		assert.equal(failed.error.length, 300);
		assert.ok(!failed.error.includes("\n"));
		assert.equal(failed.response.length, 2048);
	});

	it("settle skips an id that is gone", async () => {
		await queueOf().settle([{ id: 99, ok: true }], { retryDelays: DELAYS });
		assert.deepEqual(await rows(), []);
	});

	it("resetSending puts sending back to pending", async () => {
		const queue = queueOf();
		await queue.add([row(), row()]);
		await queue.claimDue({ channel: "webhook", limit: 1 });
		await queue.resetSending();
		assert.deepEqual(
			(await rows()).map((one) => one.status),
			["pending", "pending"],
		);
	});

	it("dropTarget drops the pending rows of one target only", async () => {
		const queue = queueOf();
		await queue.add([row({ target_id: 1 }), row({ target_id: 2 }), row({ target_id: 1 })]);
		await queue.claimDue({ channel: "webhook", limit: 1 });
		await queue.dropTarget("webhook", 1);
		const list = await rows();
		assert.deepEqual(
			list.map((one) => one.status),
			["sending", "pending", "dropped"],
		);
		assert.equal(list[2].payload, null);
	});

	it("prunes mail rows after their days, never a pending one", async () => {
		const queue = queueOf();
		await queue.add([row({ channel: "mail" }), row({ channel: "mail" }), row({ channel: "mail" }), row()]);
		await taking();
		await queue.settle(
			[
				{ id: 1, ok: true },
				{ id: 2, ok: true },
			],
			{ retryDelays: DELAYS },
		);
		await db
			.knex(TABLE)
			.where({ id: 1 })
			.update({ modified_on: sql(START - 31 * DAY) });
		await db
			.knex(TABLE)
			.where({ id: 3 })
			.update({ modified_on: sql(START - 31 * DAY) });
		await queue.pruneMail(30);
		assert.deepEqual(
			(await rows()).map((one) => one.id),
			[2, 3, 4],
		);
	});

	it("prunes a webhook to its newest rows and its days", async () => {
		const queue = queueOf();
		await queue.add([1, 2, 3, 4, 5].map(() => row({ target_id: 7 })).concat([row({ target_id: 8 })]));
		await taking();
		await queue.settle(
			[1, 2, 3, 4, 5, 6].map((id) => ({ id, ok: true })),
			{ retryDelays: DELAYS },
		);
		await db
			.knex(TABLE)
			.where({ id: 5 })
			.update({ modified_on: sql(START - 31 * DAY) });
		await queue.pruneTarget(7, 3, 30);
		assert.deepEqual(
			(await rows()).map((one) => one.id),
			[2, 3, 4, 6],
		);
	});

	it("clears the payload of a failed row 7 days after", async () => {
		const queue = queueOf();
		await queue.add([row(), row()]);
		await taking();
		await queue.settle(
			[
				{ id: 1, ok: false },
				{ id: 2, ok: false },
			],
			{ retryDelays: DELAYS },
		);
		clock.at += 6 * DAY;
		await queue.clearOldPayloads(7);
		assert.ok((await rows()).every((one) => one.payload !== null));
		clock.at += 2 * DAY;
		await queue.clearOldPayloads(7);
		assert.ok((await rows()).every((one) => one.payload === null));
	});
	it("settle never overwrites a row that left sending", async () => {
		const queue = queueOf();
		await queue.add([row({ target_id: 1 })]);
		await queue.settle([{ id: 1, ok: true }], { retryDelays: DELAYS });
		assert.equal((await rows())[0].status, "pending");
		await db.knex(TABLE).update({ status: "dropped" });
		await queue.settle([{ id: 1, ok: true }], { retryDelays: DELAYS });
		assert.equal((await rows())[0].status, "dropped");
	});

	it("claims a row once when two claimers meet, and never one dropped in between", async () => {
		const queue = queueOf();
		await queue.add([row({ target_id: 1 }), row({ target_id: 2 })]);
		const both = await Promise.all([
			queue.claimDue({ channel: "webhook" }),
			queue.claimDue({ channel: "webhook" }),
		]);
		assert.equal(both[0].length + both[1].length, 2);
		await db.knex(TABLE).update({ status: "pending" });
		// the first row is dropped right after the select answered: the update finds it no longer pending
		let dropped;
		const onResponse = () => {
			db.knex.removeListener("query-response", onResponse);
			dropped = queue.dropTarget("webhook", 1);
		};
		db.knex.on("query-response", onResponse);
		const got = await queue.claimDue({ channel: "webhook" });
		await dropped;
		assert.deepEqual(
			got.map((one) => one.target_id),
			[2],
		);
		assert.equal((await rows())[0].status, "dropped");
	});

	it("add inserts every row or none", async () => {
		const queue = queueOf();
		await assert.rejects(queue.add([row(), row({ event: null })]));
		assert.deepEqual(await rows(), []);
	});

	it("pruneTarget with keep 0 removes every final row of the target", async () => {
		const queue = queueOf();
		await queue.add([row({ target_id: 7 }), row({ target_id: 7 }), row({ target_id: 7 })]);
		await taking();
		await queue.settle(
			[
				{ id: 1, ok: true },
				{ id: 2, ok: true },
			],
			{ retryDelays: DELAYS },
		);
		await queue.pruneTarget(7, 0, 30);
		assert.deepEqual(
			(await rows()).map((one) => one.id),
			[3],
		);
	});
});

// timers without the poll: a test runs its passes itself (runOnce) after the start
const noPoll = {
	setTimeout: (...args) => setTimeout(...args),
	clearTimeout: (timer) => clearTimeout(timer),
	setInterval: () => ({ unref() {} }),
	clearInterval: () => {},
};

describe("worker", () => {
	// a started worker (its start pass finds the queue empty) unless started is false
	const setup = (channels, { started = true, ...extra } = {}) => {
		const queue = queueOf();
		const log = logOf();
		const worker = createWorker({ queue, channels, log, ...(started ? { clock: noPoll } : {}), ...extra });
		if (started) worker.start();
		return { queue, worker, log };
	};

	it("sends the due rows only; a future row waits", async () => {
		const channel = channelOf("webhook");
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 }), row({ target_id: 2, delay_ms: MINUTE })]);
		await worker.runOnce();
		assert.equal(channel.sent.length, 1);
		assert.deepEqual(
			(await rows()).map((one) => one.status),
			["sent", "pending"],
		);
		clock.at += MINUTE;
		await worker.runOnce();
		assert.deepEqual(
			(await rows()).map((one) => one.status),
			["sent", "sent"],
		);
	});

	it("retries on the channel's schedule, then fails", async () => {
		const channel = channelOf("webhook", {
			send: async (list) => list.map((one) => ({ id: one.id, ok: false, retry: true, error: "down" })),
		});
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		assert.deepEqual([(await rows())[0].status, (await rows())[0].attempts], ["pending", 1]);
		await worker.runOnce();
		assert.equal((await rows())[0].attempts, 1);
		clock.at += 60_000;
		await worker.runOnce();
		assert.equal((await rows())[0].attempts, 2);
		clock.at += 300_000;
		await worker.runOnce();
		const [last] = await rows();
		assert.equal(last.status, "failed");
		assert.equal(last.attempts, 3);
	});

	it("a throwing send retries its rows and the other channel still sends", async () => {
		const broken = channelOf("webhook", {
			send: () => Promise.reject(new Error("kaput")),
		});
		const mail = channelOf("mail");
		const { queue, worker, log } = setup([broken, mail]);
		await queue.add([row({ target_id: 1 }), row({ channel: "mail" })]);
		await worker.runOnce();
		assert.equal(mail.sent.length, 1);
		const [first, second] = await rows();
		assert.equal(first.status, "pending");
		assert.equal(first.attempts, 1);
		assert.equal(second.status, "sent");
		assert.ok(log.lines.some((line) => line.includes("kaput")));
	});

	it("a row the channel gives no result for is retried", async () => {
		const silent = channelOf("webhook", { send: async () => [] });
		const { queue, worker } = setup([silent]);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		const [only] = await rows();
		assert.equal(only.status, "pending");
		assert.equal(only.attempts, 1);
	});

	it("a failing queue is logged, not thrown", async () => {
		const queue = { claimDue: async () => Promise.reject(new Error("db gone")) };
		const log = logOf();
		const worker = createWorker({ queue, channels: [channelOf("mail")], log, clock: noPoll });
		worker.start();
		await worker.runOnce();
		assert.ok(log.lines.some((line) => line.includes("db gone")));
	});

	it("sends a mail group of three due rows as one call", async () => {
		const channel = channelOf("mail");
		const { queue, worker } = setup([channel]);
		const group = { channel: "mail", group_key: "alerts:a@b.c" };
		await queue.add([row(group), row(group), row(group), row({ channel: "mail" })]);
		await worker.runOnce();
		assert.deepEqual(
			channel.sent.map((list) => list.length),
			[3, 1],
		);
		assert.ok((await rows()).every((one) => one.status === "sent"));
	});

	it("sends two rows of one target one after the other, targets side by side", async () => {
		let running = 0;
		let peak = 0;
		const byTarget = new Map();
		const channel = channelOf("webhook", {
			maxConcurrent: 5,
			send: async (list) => {
				running += 1;
				peak = Math.max(peak, running);
				const target = list[0].target_id;
				byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
				assert.equal(byTarget.get(target), 1);
				await delay(15);
				byTarget.set(target, byTarget.get(target) - 1);
				running -= 1;
				return list.map((one) => ({ id: one.id, ok: true }));
			},
		});
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 }), row({ target_id: 1 }), row({ target_id: 2 }), row({ target_id: 2 })]);
		await worker.runOnce();
		assert.equal(peak, 2);
		assert.ok((await rows()).every((one) => one.status === "sent"));
	});

	it("a channel with maxConcurrent 1 sends one call at a time", async () => {
		let running = 0;
		let peak = 0;
		const channel = channelOf("mail", {
			send: async (list) => {
				running += 1;
				peak = Math.max(peak, running);
				await delay(10);
				running -= 1;
				return list.map((one) => ({ id: one.id, ok: true }));
			},
		});
		const { queue, worker } = setup([channel]);
		await queue.add([row({ channel: "mail" }), row({ channel: "mail" })]);
		await worker.runOnce();
		assert.equal(peak, 1);
	});

	it("takes channels from a function, so a later registered one sends", async () => {
		const list = [];
		const { queue, worker } = setup(() => list);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		assert.equal((await rows())[0].status, "pending");
		list.push(channelOf("webhook"));
		await worker.runOnce();
		assert.equal((await rows())[0].status, "sent");
	});

	it("no pass while paused; two pauses need two resumes", async () => {
		const channel = channelOf("webhook");
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		worker.pause();
		worker.pause();
		assert.equal(worker.paused(), true);
		await worker.runOnce();
		assert.equal(channel.sent.length, 0);
		worker.resume();
		assert.equal(worker.paused(), true);
		await worker.runOnce();
		assert.equal(channel.sent.length, 0);
		worker.resume();
		assert.equal(worker.paused(), false);
		await worker.runOnce();
		assert.equal(channel.sent.length, 1);
	});

	it("pauseAndWait waits for a running slow send", async () => {
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let started;
		const begun = new Promise((resolve) => {
			started = resolve;
		});
		const channel = channelOf("webhook", {
			send: async (list) => {
				started();
				await gate;
				return list.map((one) => ({ id: one.id, ok: true }));
			},
		});
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		const pass = worker.runOnce();
		await begun;
		assert.equal(worker.busy(), true);
		let done = false;
		const waiting = worker.pauseAndWait({ timeoutMs: 5000 }).then(() => {
			done = true;
		});
		await delay(20);
		assert.equal(done, false);
		release();
		await waiting;
		await pass;
		assert.equal(worker.busy(), false);
		assert.equal(worker.paused(), true);
		assert.equal((await rows())[0].status, "sent");
	});

	it("pauseAndWait rejects with writer-running after its limit and ends its pause", async () => {
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let started;
		const begun = new Promise((resolve) => {
			started = resolve;
		});
		const channel = channelOf("webhook", {
			send: async (list) => {
				started();
				await gate;
				return list.map((one) => ({ id: one.id, ok: true }));
			},
		});
		const { queue, worker } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		const pass = worker.runOnce();
		await begun;
		await assert.rejects(worker.pauseAndWait({ timeoutMs: 20 }), WRITER_RUNNING);
		assert.equal(worker.paused(), false);
		release();
		await pass;
	});

	it("pauseAndWait with nothing running resolves at once", async () => {
		const { worker } = setup([]);
		await worker.pauseAndWait({ timeoutMs: 10 });
		assert.equal(worker.paused(), true);
	});

	it("start polls once and stop ends it; kick makes a pass soon", async () => {
		const channel = channelOf("webhook");
		const { queue, worker } = setup([channel], { started: false, pollMs: 10_000 });
		assert.equal(worker.start(), true);
		assert.equal(worker.start(), false);
		await queue.add([row({ target_id: 1 })]);
		worker.kick();
		worker.kick();
		await delay(200);
		assert.equal(channel.sent.length, 1);
		worker.stop();
		worker.stop();
		worker.pause();
		worker.kick();
		worker.resume();
	});

	it("the poll runs a pass by itself", async () => {
		const channel = channelOf("webhook");
		const { queue, worker } = setup([channel], { started: false, pollMs: 20 });
		worker.start();
		await worker.runOnce();
		await queue.add([row({ target_id: 1 })]);
		await delay(150);
		worker.stop();
		assert.equal(channel.sent.length, 1);
	});

	it("a full claim runs the next pass at once", async () => {
		const channel = channelOf("webhook", { maxConcurrent: 10 });
		const { queue, worker } = setup([channel]);
		await queue.add(Array.from({ length: 55 }, (_, index) => row({ target_id: index })));
		await worker.runOnce();
		assert.ok((await rows()).every((one) => one.status === "sent"));
	});
	it("a settle that throws on one row still sends the next, and logs it cleaned", async () => {
		const channel = channelOf("webhook");
		const { queue, worker, log } = setup([channel]);
		const settle = queue.settle;
		let calls = 0;
		queue.settle = (...args) => {
			calls += 1;
			if (calls === 1) return Promise.reject(new Error("db down https://u:pw@h.example/p?token=abc"));
			return settle(...args);
		};
		await queue.add([row({ target_id: 1 }), row({ target_id: 1 })]);
		await worker.runOnce();
		assert.equal(channel.sent.length, 2);
		const [first, second] = await rows();
		assert.equal(first.status, "sending");
		assert.equal(second.status, "sent");
		assert.ok(log.lines.some((line) => line.includes("settle failed")));
	});

	it("a thrown send keeps its cleaned reason in the row and the log", async () => {
		const secret = "tok3n-secret-value";
		const channel = channelOf("webhook", {
			send: () => Promise.reject(new Error(`POST failed ${"x".repeat(400)} ${secret}`)),
		});
		const { queue, worker, log } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		const [only] = await rows();
		assert.equal(only.status, "pending");
		assert.equal(only.error.length, 300);
		assert.ok(only.error.startsWith("POST failed"));
		assert.ok(log.lines.every((line) => line.length < 400));
	});

	it("a thrown send error with a URL keeps no password or token in the row or the log", async () => {
		const message = `connect failed https://user:${PASSWORD}@hook.example/x?token=${TOKEN}`;
		const channel = channelOf("webhook", { send: () => Promise.reject(new Error(message)) });
		const { queue, worker, log } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		const [only] = await rows();
		assert.equal(only.error, "connect failed https://***@hook.example/x?***");
		for (const text of [only.error, ...log.lines]) {
			assert.ok(!text.includes(PASSWORD) && !text.includes(TOKEN), text);
		}
		assert.ok(log.lines.some((line) => line.includes("send failed")));
	});

	it("a URL cut at the length limit keeps no part of its password", async () => {
		const secret = "longpassword-0123456789";
		const prefix = "x".repeat(300 - "https://user:longpass".length);
		const channel = channelOf("webhook", {
			send: () => Promise.reject(new Error(`${prefix}https://user:${secret}@hook.example/x`)),
		});
		const { queue, worker, log } = setup([channel]);
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		const [only] = await rows();
		for (const text of [only.error, ...log.lines]) {
			assert.ok(!text.includes("longpass"), text);
		}
	});

	it("the settle failure line keeps no password or token either", async () => {
		const channel = channelOf("webhook");
		const { queue, worker, log } = setup([channel]);
		queue.settle = () => Promise.reject(new Error(`db https://user:${PASSWORD}@db.example/x?token=${TOKEN} down`));
		await queue.add([row({ target_id: 1 })]);
		await worker.runOnce();
		const line = log.lines.find((one) => one.includes("settle failed"));
		assert.ok(line);
		assert.ok(!line.includes(PASSWORD) && !line.includes(TOKEN), line);
	});

	it("pauseAndWait waits for the other lanes too", async () => {
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		const channel = channelOf("webhook", {
			maxConcurrent: 2,
			send: async (list) => {
				if (list[0].target_id === 2) await gate;
				return list.map((one) => ({ id: one.id, ok: true }));
			},
		});
		const { queue, worker } = setup([channel]);
		const settle = queue.settle;
		queue.settle = (results, options) =>
			results[0].id === 1 ? Promise.reject(new Error("db down")) : settle(results, options);
		await queue.add([row({ target_id: 1 }), row({ target_id: 2 })]);
		const pass = worker.runOnce();
		await delay(30);
		let done = false;
		const waiting = worker.pauseAndWait({ timeoutMs: 5000 }).then(() => {
			done = true;
		});
		await delay(30);
		assert.equal(done, false);
		release();
		await waiting;
		await pass;
		assert.equal((await rows())[1].status, "sent");
	});

	it("a kick after stop arms nothing until start again", async () => {
		const channel = channelOf("webhook");
		const { queue, worker } = setup([channel], { started: false, pollMs: 10_000 });
		worker.start();
		await worker.runOnce();
		await queue.add([row({ target_id: 1 })]);
		worker.stop();
		worker.kick();
		await delay(120);
		assert.equal(channel.sent.length, 0);
		worker.start();
		await delay(200);
		worker.stop();
		assert.equal(channel.sent.length, 1);
	});

	it("before start no pass runs and no timer is armed; the start sends what was queued, once", async () => {
		const channel = channelOf("webhook");
		const timers = [];
		const counting = {
			...noPoll,
			setTimeout: (...args) => {
				timers.push("timeout");
				return setTimeout(...args);
			},
			setInterval: () => {
				timers.push("interval");
				return { unref() {} };
			},
		};
		const { queue, worker } = setup([channel], { started: false, clock: counting });
		await queue.add([row({ target_id: 1 })]);
		worker.kick();
		await worker.runOnce();
		await delay(120);
		assert.deepEqual(timers, []);
		assert.equal(worker.waiting(), true);
		assert.equal(channel.sent.length, 0);
		assert.equal((await rows())[0].status, "pending");
		assert.equal(worker.start(), true);
		assert.equal(worker.waiting(), false);
		await worker.runOnce();
		await worker.runOnce();
		assert.equal(channel.sent.length, 1);
		assert.equal((await rows())[0].status, "sent");
		worker.stop();
	});
});

describe("notify", () => {
	const setup = (extra = {}) => {
		const queue = queueOf();
		const log = logOf();
		const stateStore = createStateStore({ knex: db.knex, clock });
		const worker = {
			kicks: 0,
			kick() {
				this.kicks += 1;
			},
		};
		let counter = 0;
		const notify = createNotify({
			stateStore,
			queue,
			worker,
			log,
			clock,
			randomId: () => {
				counter += 1;
				return `msg_${"a".repeat(25)}${String.fromCharCode(96 + counter)}`;
			},
			...extra,
		});
		return { notify, queue, worker, log, stateStore };
	};
	const host = {
		type: "proxy_host",
		id: 3,
		domain_names: ["a.example.com"],
		enabled: true,
		user: { id: 1, name: "t" },
	};

	it("with no channel emit writes nothing and does not throw", async () => {
		const { notify, worker } = setup();
		assert.equal(await notify.emit("host.created", host), undefined);
		assert.deepEqual(await rows(), []);
		assert.equal(worker.kicks, 0);
	});

	it("a channel that accepts gets one row per target, with the envelope as payload", async () => {
		const { notify, worker, log } = setup();
		notify.registerChannel(
			channelOf("mail", {
				targets: async () => [
					{ recipient: "a@b.c", group_key: "alerts:a@b.c", delay_ms: 60_000 },
					{ recipient: "d@e.f" },
				],
			}),
		);
		assert.equal(await notify.emit("host.created", host), undefined);
		const [first, second] = await rows();
		assert.equal(first.channel, "mail");
		assert.equal(first.event, "host.created");
		assert.equal(first.recipient, "a@b.c");
		assert.equal(first.group_key, "alerts:a@b.c");
		assert.equal(first.next_try_on, sql(START + 60_000));
		assert.equal(second.next_try_on, null);
		assert.equal(first.message_id, second.message_id);
		assert.match(first.message_id, MESSAGE_ID);
		const envelope = JSON.parse(first.payload);
		assert.equal(envelope.id, first.message_id);
		assert.equal(envelope.type, "host.created");
		assert.equal(envelope.timestamp, "2026-11-26T10:00:00.000Z");
		assert.equal(envelope.data.id, 3);
		assert.equal(worker.kicks, 1);
		assert.ok(log.lines.includes("debug notify: host.created 3"));
	});

	it("a channel that does not accept the event gets no row", async () => {
		const { notify } = setup();
		notify.registerChannel(channelOf("webhook", { accepts: async (type) => type !== "host.created" }));
		await notify.emit("host.created", host);
		assert.deepEqual(await rows(), []);
	});

	it("a channel that throws in targets is logged and the other still gets its row", async () => {
		const { notify, log } = setup();
		notify.registerChannel(
			channelOf("mail", {
				targets: () => Promise.reject(new Error("no recipients")),
			}),
		);
		notify.registerChannel(channelOf("webhook"));
		assert.equal(await notify.emit("host.created", host), undefined);
		const list = await rows();
		assert.deepEqual(
			list.map((one) => one.channel),
			["webhook"],
		);
		assert.ok(log.lines.some((line) => line.startsWith("warn") && line.includes("no recipients")));
	});

	it("a failing accepts is logged the same way", async () => {
		const { notify, log } = setup();
		notify.registerChannel(
			channelOf("mail", {
				accepts: () => {
					throw new Error("bad setting");
				},
			}),
		);
		await notify.emit("host.created", host);
		assert.ok(log.lines.some((line) => line.includes("bad setting")));
	});

	it("registerChannel replaces a channel of the same id", () => {
		const { notify } = setup();
		const first = channelOf("mail");
		const second = channelOf("mail");
		notify.registerChannel(first);
		notify.registerChannel(second);
		assert.deepEqual(notify.channels(), [second]);
	});

	it("never throws and resolves undefined whatever fails, and logs no data", async () => {
		const { notify, log } = setup({
			queue: {
				add: () => Promise.reject(new Error("table gone")),
			},
		});
		notify.registerChannel(channelOf("webhook"));
		assert.equal(await notify.emit("host.created", host), undefined);
		assert.equal(await notify.emit("nope.event", {}), undefined);
		assert.equal(await notify.emit("host.created", null), undefined);
		assert.ok(log.lines.some((line) => line.includes("table gone")));
		assert.ok(log.lines.every((line) => !line.includes("a.example.com")));
	});

	it("an unknown event is a logged error, not a row", async () => {
		const { notify, log } = setup();
		notify.registerChannel(channelOf("webhook"));
		await notify.deliver("nope.event", {});
		assert.match(log.lines.join("\n"), NOT_EVENT);
		assert.deepEqual(await rows(), []);
	});

	it("reportState emits only on a change", async () => {
		const { notify } = setup();
		notify.registerChannel(channelOf("webhook"));
		const source = { type: "proxy_host", id: 3, domain_names: ["a.example.com"], error: "nginx: bad" };
		await notify.reportState("host.config_error", "proxy_host:3", { state: "ok", source });
		assert.deepEqual(await rows(), []);
		await notify.reportState("host.config_error", "proxy_host:3", { state: "bad", source });
		await notify.reportState("host.config_error", "proxy_host:3", { state: "bad", source });
		assert.deepEqual(
			(await rows()).map((one) => one.event),
			["host.config_error"],
		);
		await notify.reportState("host.config_error", "proxy_host:3", { state: "ok", source });
		await notify.reportState("host.config_error", "proxy_host:3", { state: "ok", source });
		const list = await rows();
		assert.deepEqual(
			list.map((one) => one.event),
			["host.config_error", "host.config_error.resolved"],
		);
		assert.equal(JSON.parse(list[0].payload).data.error, "nginx: bad");
	});

	it("reportState with a fake store passes the built data and sends what the store returns", async () => {
		const calls = [];
		const stateStore = {
			report: (call) => {
				calls.push(call);
				return Promise.resolve({ type: "host.config_error.resolved", data: { type: "proxy_host", id: 9 } });
			},
		};
		const { notify } = setup({ stateStore });
		notify.registerChannel(channelOf("webhook"));
		await notify.reportState("host.config_error", "proxy_host:9", {
			state: "ok",
			source: { type: "proxy_host", id: 9 },
		});
		assert.equal(calls[0].event, "host.config_error");
		assert.equal(calls[0].objectId, "proxy_host:9");
		assert.equal(calls[0].state, "ok");
		assert.equal((await rows())[0].event, "host.config_error.resolved");
	});

	it("reportState catches a failing store", async () => {
		const { notify, log } = setup({
			stateStore: {
				report: () => Promise.reject(new Error("store down")),
			},
		});
		assert.equal(await notify.reportState("host.config_error", "x", { state: "bad" }), false);
		assert.ok(log.lines.some((line) => line.includes("store down")));
	});

	it("clearState and clearMatching remove the state and catch errors", async () => {
		const { notify, log } = setup();
		await notify.reportState("host.config_error", "proxy_host:3", { state: "bad", source: { id: 3 } });
		await notify.reportState("host.config_error", "proxy_host:3:x", { state: "bad", source: { id: 3 } });
		await notify.reportState("host.config_error", "proxy_host:4", { state: "bad", source: { id: 4 } });
		assert.equal(await notify.clearState("host.config_error", "proxy_host:4"), true);
		assert.equal(await notify.clearMatching("host.config_error", "proxy_host:3"), undefined);
		assert.deepEqual(await db.knex(STATE), []);
		assert.equal(await notify.clearState("not.an.event", "1"), false);
		assert.equal(await notify.clearMatching("not.an.event", "1"), undefined);
		assert.equal(log.lines.filter((line) => line.startsWith("warn")).length, 2);
	});

	it("a restart keeps the stored state: a second notify over the same rows repeats nothing", async () => {
		const first = setup();
		first.notify.registerChannel(channelOf("webhook"));
		const source = { type: "proxy_host", id: 3, error: "bad" };
		await first.notify.reportState("host.config_error", "proxy_host:3", { state: "bad", source });
		const second = setup();
		second.notify.registerChannel(channelOf("webhook"));
		await second.notify.reportState("host.config_error", "proxy_host:3", { state: "bad", source });
		assert.equal((await rows()).length, 1);
	});
});
