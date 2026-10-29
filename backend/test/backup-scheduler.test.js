import assert from "node:assert/strict";
import { it } from "node:test";
import { createBackupScheduler } from "../lib/backup/scheduler.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const MINUTE = 60_000;

const fakeClock = () => {
	const clock = {
		value: 0,
		timers: [],
		now: () => clock.value,
		setTimeout: (fn, ms) => clock.timers.push({ fn, at: clock.value + ms, every: 0 }) - 1,
		setInterval: (fn, ms) => clock.timers.push({ fn, at: clock.value + ms, every: ms }) - 1,
		clearTimeout: (id) => {
			clock.timers[id] = null;
		},
		clearInterval: (id) => {
			clock.timers[id] = null;
		},
		// moves time forward and fires the timers that are due, awaiting each
		advance: async (ms) => {
			const end = clock.value + ms;
			for (;;) {
				const due = clock.timers
					.map((timer, id) => ({ timer, id }))
					.filter(({ timer }) => timer && timer.at <= end)
					.sort((a, b) => a.timer.at - b.timer.at)[0];
				if (!due) break;
				clock.value = due.timer.at;
				if (due.timer.every) due.timer.at += due.timer.every;
				else clock.timers[due.id] = null;
				await due.timer.fn();
			}
			clock.value = end;
		},
	};
	return clock;
};

const busyError = () => Object.assign(new Error("busy"), { code: "busy" });

it("the first tick runs 5 minutes after start, then every minute", async () => {
	const clock = fakeClock();
	const ticks = [];
	const scheduler = createBackupScheduler({
		dueSchedules: async (nowMs) => {
			ticks.push(nowMs);
			return [];
		},
		runAutomatic: async () => {},
		giveUp: async () => {},
		clock,
		log: silent,
	});
	assert.equal(scheduler.start(), true);
	assert.equal(scheduler.start(), false);
	await clock.advance(5 * MINUTE - 1);
	assert.deepEqual(ticks, []);
	await clock.advance(1);
	await clock.advance(2 * MINUTE);
	assert.deepEqual(ticks, [5 * MINUTE, 6 * MINUTE, 7 * MINUTE]);
	scheduler.stop();
	await clock.advance(10 * MINUTE);
	assert.equal(ticks.length, 3);
});

it("runs due schedules one after another in the given order", async () => {
	const clock = fakeClock();
	const order = [];
	let running = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [{ id: 2 }, { id: 1 }],
		runAutomatic: async (row) => {
			running++;
			assert.equal(running, 1);
			order.push(row.id);
			running--;
		},
		giveUp: async () => {},
		clock,
		log: silent,
	});
	await scheduler.tick();
	assert.deepEqual(order, [2, 1]);
});

it("a tick never overlaps the one still running", async () => {
	const clock = fakeClock();
	let release;
	let calls = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [{ id: 1 }],
		runAutomatic: () => {
			calls++;
			return new Promise((resolve) => {
				release = resolve;
			});
		},
		giveUp: async () => {},
		clock,
		log: silent,
	});
	const first = scheduler.tick();
	await scheduler.tick();
	assert.equal(calls, 1);
	release();
	await first;
});

it("a busy schedule waits and is given up after 60 minutes", async () => {
	const clock = fakeClock();
	const given = [];
	let attempts = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => (given.length ? [] : [{ id: 1, name: "Nightly" }]),
		runAutomatic: async () => {
			attempts++;
			throw busyError();
		},
		giveUp: async (row) => given.push([row.id, clock.now()]),
		clock,
		log: silent,
	});
	await scheduler.tick();
	clock.value = 59 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(given, []);
	clock.value = 60 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(given, [[1, 60 * MINUTE]]);
	assert.equal(attempts, 3);
});

it("a run that gets through after waiting starts a new wait next time", async () => {
	const clock = fakeClock();
	const given = [];
	let busy = true;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [{ id: 1 }],
		runAutomatic: async () => {
			if (busy) throw busyError();
		},
		giveUp: async (row) => given.push(row.id),
		clock,
		log: silent,
	});
	await scheduler.tick();
	clock.value = 30 * MINUTE;
	busy = false;
	await scheduler.tick();
	busy = true;
	clock.value = 70 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(given, []);
});

it("an unexpected error is logged and the next schedule still runs", async () => {
	const clock = fakeClock();
	const errors = [];
	const ran = [];
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [
			{ id: 1, name: "a" },
			{ id: 2, name: "b" },
		],
		runAutomatic: async (row) => {
			if (row.id === 1) throw new Error("database gone");
			ran.push(row.id);
		},
		giveUp: async () => {},
		clock,
		log: { ...silent, error: (message) => errors.push(message) },
	});
	await scheduler.tick();
	assert.deepEqual(ran, [2]);
	assert.equal(errors.length, 1);
});

it("a schedule that is no longer due drops its wait", async () => {
	const clock = fakeClock();
	const given = [];
	let due = true;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => (due ? [{ id: 1 }] : []),
		runAutomatic: async () => {
			throw busyError();
		},
		giveUp: async (row) => given.push(row.id),
		clock,
		log: silent,
	});
	await scheduler.tick();
	due = false;
	clock.value = 50 * MINUTE;
	await scheduler.tick();
	due = true;
	clock.value = 70 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(given, []);
});

it("a failing dueSchedules or giveUp is logged and the next tick still works", async () => {
	const clock = fakeClock();
	const errors = [];
	let fail = true;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => {
			if (fail) throw new Error("database down");
			return [{ id: 1 }];
		},
		runAutomatic: async () => {
			throw busyError();
		},
		giveUp: async () => {
			throw new Error("write failed");
		},
		clock,
		log: { ...silent, error: (message) => errors.push(message) },
	});
	await scheduler.tick();
	fail = false;
	await scheduler.tick();
	clock.value = 61 * MINUTE;
	await scheduler.tick();
	assert.equal(errors.length, 2);
});

it("pause waits for a running tick, skips later ticks and resume starts them again", async () => {
	const clock = fakeClock();
	let finish;
	let calls = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => {
			calls += 1;
			return [{ id: 1, name: "slow" }];
		},
		runAutomatic: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		giveUp: async () => {},
		clock,
		log: silent,
	});
	const running = scheduler.tick();
	await new Promise((resolve) => setImmediate(resolve));
	let paused = false;
	const pausing = scheduler.pause().then(() => {
		paused = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(paused, false);
	finish();
	await running;
	await pausing;
	assert.equal(paused, true);
	await scheduler.tick();
	assert.equal(calls, 1);
	scheduler.resume();
	const again = scheduler.tick();
	await new Promise((resolve) => setImmediate(resolve));
	finish();
	await again;
	assert.equal(calls, 2);
});

it("a pause that runs out of time leaves the scheduler running", async () => {
	const clock = fakeClock();
	let finish;
	let calls = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => {
			calls += 1;
			return [{ id: 1, name: "slow" }];
		},
		runAutomatic: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		giveUp: async () => {},
		clock,
		log: silent,
	});
	const running = scheduler.tick();
	await new Promise((resolve) => setImmediate(resolve));
	const pausing = scheduler.pause({ timeoutMs: MINUTE });
	await clock.advance(MINUTE);
	await assert.rejects(
		pausing,
		(error) => error.code === "writer-running" && error.status === 409 && error.details === "Backup scheduler",
	);
	finish();
	await running;
	// not paused: the next tick runs, and resume() without a pause does nothing
	scheduler.resume();
	const again = scheduler.tick();
	await new Promise((resolve) => setImmediate(resolve));
	finish();
	await again;
	assert.equal(calls, 2);
});

it("resume runs nothing by itself and the paused time does not count toward a busy wait", async () => {
	const clock = fakeClock();
	const runs = [];
	const givenUp = [];
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [{ id: 7, name: "nightly" }],
		runAutomatic: async () => {
			runs.push(clock.now());
			throw busyError();
		},
		giveUp: async (row) => {
			givenUp.push(row.id);
		},
		clock,
		log: silent,
	});
	await scheduler.tick();
	clock.value = 50 * MINUTE;
	await scheduler.pause();
	clock.value = 80 * MINUTE;
	scheduler.resume();
	assert.equal(runs.length, 1);
	// 50 minutes waited before the pause and none after it: not given up yet
	await scheduler.tick();
	assert.deepEqual(givenUp, []);
	clock.value = 91 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(givenUp, [7]);
	assert.equal(runs.length, 3);
});

it("a pause and resume with nothing in between keep the busy wait as it was", async () => {
	const clock = fakeClock();
	const givenUp = [];
	const scheduler = createBackupScheduler({
		dueSchedules: async () => [{ id: 7, name: "nightly" }],
		runAutomatic: async () => {
			throw busyError();
		},
		giveUp: async (row) => {
			givenUp.push(row.id);
		},
		clock,
		log: silent,
	});
	await scheduler.tick();
	clock.value = 30 * MINUTE;
	await scheduler.pause();
	scheduler.resume();
	clock.value = 60 * MINUTE;
	await scheduler.tick();
	assert.deepEqual(givenUp, [7]);
});

it("a pause has one owner: a second pause resolves at once and one resume ends it", async () => {
	const clock = fakeClock();
	let calls = 0;
	const scheduler = createBackupScheduler({
		dueSchedules: async () => {
			calls += 1;
			return [];
		},
		runAutomatic: async () => {},
		giveUp: async () => {},
		clock,
		log: silent,
	});
	await scheduler.pause();
	await scheduler.pause();
	await scheduler.tick();
	assert.equal(calls, 0);
	scheduler.resume();
	await scheduler.tick();
	assert.equal(calls, 1);
});
