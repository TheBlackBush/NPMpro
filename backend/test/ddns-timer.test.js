import assert from "node:assert/strict";
import { it } from "node:test";
import { createDdnsTimer } from "../lib/ddns-timer.js";

const MIN = 60_000;
const BOOM = /boom/u;
const BAD_CYCLE = /bad cycle/u;

// a clock that only moves when advance() is called
const fakeClock = () => {
	let time = 1_000_000;
	let next = 1;
	const timers = new Map();
	const clock = {
		now: () => time,
		setTimeout: (fn, ms) => {
			const id = next++;
			timers.set(id, { fn, at: time + ms });
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
		setInterval: (fn, ms) => {
			const id = next++;
			timers.set(id, { fn, at: time + ms, every: ms });
			return id;
		},
		clearInterval: (id) => timers.delete(id),
		timers,
		advance: async (ms) => {
			const end = time + ms;
			while (true) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				const [id, timer] = due;
				time = timer.at;
				if (timer.every) timer.at += timer.every;
				else timers.delete(id);
				timer.fn();
				await new Promise((resolve) => setImmediate(resolve));
			}
			time = end;
		},
	};
	return clock;
};

const gate = () => {
	let open;
	const promise = new Promise((resolve) => {
		open = resolve;
	});
	return { promise, open };
};

it("runs the first cycle after the first delay, then every period", async () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createDdnsTimer({ run: () => runs++, periodMs: 5 * MIN, clock });
	assert.equal(timer.nextRunOn(), null);
	assert.equal(timer.start(), true);
	assert.equal(timer.start(), false);
	assert.equal(timer.nextRunOn(), clock.now() + MIN);
	await clock.advance(MIN - 1);
	assert.equal(runs, 0);
	await clock.advance(1);
	assert.equal(runs, 1);
	assert.equal(timer.nextRunOn(), clock.now() + 5 * MIN);
	await clock.advance(5 * MIN);
	assert.equal(runs, 2);
});

it("skips a tick while a cycle runs", async () => {
	const clock = fakeClock();
	const hold = gate();
	let runs = 0;
	const timer = createDdnsTimer({
		run: () => {
			runs++;
			return hold.promise;
		},
		periodMs: MIN,
		firstDelayMs: MIN,
		clock,
	});
	timer.start();
	await clock.advance(MIN);
	assert.equal(runs, 1);
	assert.equal(timer.busy(), true);
	await clock.advance(3 * MIN);
	assert.equal(runs, 1);
	hold.open();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(timer.busy(), false);
	await clock.advance(MIN);
	assert.equal(runs, 2);
});

it("skips ticks while paused; two pauses need two resumes", async () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createDdnsTimer({ run: () => runs++, periodMs: MIN, firstDelayMs: MIN, clock });
	timer.start();
	timer.pause();
	timer.pause();
	await clock.advance(3 * MIN);
	assert.equal(runs, 0);
	timer.resume();
	assert.equal(timer.paused(), true);
	await clock.advance(MIN);
	assert.equal(runs, 0);
	timer.resume();
	timer.resume();
	assert.equal(timer.paused(), false);
	await clock.advance(MIN);
	assert.equal(runs, 1);
});

it("pauseAndWait waits for the running cycle", async () => {
	const clock = fakeClock();
	const hold = gate();
	const timer = createDdnsTimer({ run: () => hold.promise, periodMs: MIN, firstDelayMs: MIN, clock, pollMs: 10 });
	timer.start();
	await clock.advance(MIN);
	let done = false;
	const waiting = timer.pauseAndWait().then(() => {
		done = true;
	});
	await clock.advance(50);
	assert.equal(done, false);
	hold.open();
	await clock.advance(20);
	await waiting;
	assert.equal(timer.paused(), true);
});

it("pauseAndWait rejects writer-running on timeout and ends its pause", async () => {
	const clock = fakeClock();
	const hold = gate();
	const timer = createDdnsTimer({ run: () => hold.promise, periodMs: MIN, firstDelayMs: MIN, clock, pollMs: 10 });
	timer.start();
	await clock.advance(MIN);
	const waiting = timer.pauseAndWait({ timeoutMs: 100 });
	const outcome = assert.rejects(waiting, (error) => error.status === 409);
	await clock.advance(200);
	await outcome;
	assert.equal(timer.paused(), false);
	hold.open();
});

it("runNow runs after a running cycle under the same lock", async () => {
	const clock = fakeClock();
	const hold = gate();
	const order = [];
	const timer = createDdnsTimer({
		run: async () => {
			order.push("cycle start");
			await hold.promise;
			order.push("cycle end");
		},
		periodMs: MIN,
		firstDelayMs: MIN,
		clock,
	});
	timer.start();
	await clock.advance(MIN);
	const manual = timer.runNow(() => {
		order.push("manual");
		return 42;
	});
	await clock.advance(0);
	assert.deepEqual(order, ["cycle start"]);
	hold.open();
	assert.equal(await manual, 42);
	assert.deepEqual(order, ["cycle start", "cycle end", "manual"]);
	assert.equal(timer.busy(), false);
});

it("runNow is refused with 409 while paused, and a failing fn frees the lock", async () => {
	const clock = fakeClock();
	const timer = createDdnsTimer({ run: () => {}, periodMs: MIN, clock });
	timer.pause();
	await assert.rejects(
		timer.runNow(() => 1),
		(error) => error.status === 409 && error.message_i18n === "error.ddns-paused" && error.public === true,
	);
	timer.resume();
	await assert.rejects(
		timer.runNow(() => {
			throw new Error("boom");
		}),
		BOOM,
	);
	assert.equal(timer.busy(), false);
	assert.equal(await timer.runNow(() => "ok"), "ok");
});

it("a failing cycle is logged and the next tick still runs", async () => {
	const clock = fakeClock();
	const logged = [];
	let runs = 0;
	const timer = createDdnsTimer({
		run: () => {
			runs++;
			throw new Error("bad cycle");
		},
		periodMs: MIN,
		firstDelayMs: MIN,
		clock,
		log: { error: (message) => logged.push(message), info: () => {} },
	});
	timer.start();
	await clock.advance(2 * MIN);
	assert.equal(runs, 2);
	assert.match(logged[0], BAD_CYCLE);
});

it("restart sets a new period and ignores an invalid one", async () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createDdnsTimer({ run: () => runs++, periodMs: 5 * MIN, firstDelayMs: MIN, clock });
	timer.restart(2 * MIN);
	assert.equal(clock.timers.size, 0);
	timer.start();
	await clock.advance(MIN);
	assert.equal(runs, 1);
	timer.restart(10 * MIN);
	timer.restart(0);
	timer.restart(Number.NaN);
	assert.equal(timer.nextRunOn(), clock.now() + 10 * MIN);
	await clock.advance(9 * MIN);
	assert.equal(runs, 1);
	await clock.advance(MIN);
	assert.equal(runs, 2);
	assert.equal(clock.timers.size, 1);
	timer.restart(MIN);
	await clock.advance(MIN);
	assert.equal(runs, 3);
});

it("restart before the first tick drops the first delay and uses the period", async () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createDdnsTimer({ run: () => runs++, periodMs: 5 * MIN, firstDelayMs: MIN, clock });
	timer.start();
	timer.restart(3 * MIN);
	await clock.advance(2 * MIN);
	assert.equal(runs, 0);
	await clock.advance(MIN);
	assert.equal(runs, 1);
});
