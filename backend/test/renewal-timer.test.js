import assert from "node:assert/strict";
import { it } from "node:test";
import { createRenewalTimer } from "../lib/renewal-timer.js";

const HOUR = 3_600_000;

const fakeClock = () => {
	let next = 1;
	const active = new Map();
	const runs = new Map();
	return {
		active,
		// runs the callbacks of the active intervals once, like one interval passing
		tick: () => {
			for (const fn of runs.values()) fn();
		},
		setInterval: (fn, ms) => {
			const id = next++;
			active.set(id, ms);
			runs.set(id, fn);
			return id;
		},
		clearInterval: (id) => {
			active.delete(id);
			runs.delete(id);
		},
	};
};

it("before start only stores the interval", () => {
	const clock = fakeClock();
	const timer = createRenewalTimer({ run: () => {}, hours: 3, clock });
	timer.restart(12);
	assert.equal(clock.active.size, 0);
	assert.equal(timer.running(), false);
	assert.equal(timer.start(), true);
	assert.deepEqual([...clock.active.values()], [12 * HOUR]);
});

it("restarts a running timer without a second interval", () => {
	const clock = fakeClock();
	const timer = createRenewalTimer({ run: () => {}, hours: 3, clock });
	timer.start();
	assert.equal(timer.start(), false);
	timer.restart(8);
	timer.restart(9);
	assert.deepEqual([...clock.active.values()], [9 * HOUR]);
	assert.equal(timer.hours(), 9);
});

it("keeps the current interval for invalid hours", () => {
	const clock = fakeClock();
	const timer = createRenewalTimer({ run: () => {}, hours: Number.NaN, clock });
	assert.equal(timer.hours(), 3);
	timer.start();
	for (const bad of [0, -1, 1.5, Number.NaN, undefined, "4"]) timer.restart(bad);
	assert.equal(timer.hours(), 3);
	assert.deepEqual([...clock.active.values()], [3 * HOUR]);
});

it("skips its runs while paused and runs again on the next interval after resume", () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createRenewalTimer({ run: () => runs++, hours: 3, clock });
	timer.start();
	clock.tick();
	assert.equal(runs, 1);
	assert.equal(timer.paused(), false);
	timer.pause();
	assert.equal(timer.paused(), true);
	clock.tick();
	clock.tick();
	assert.equal(runs, 1);
	timer.resume();
	assert.equal(timer.paused(), false);
	// resume does not run the missed run at once
	assert.equal(runs, 1);
	clock.tick();
	assert.equal(runs, 2);
});

it("stays paused across a restart", () => {
	const clock = fakeClock();
	let runs = 0;
	const timer = createRenewalTimer({ run: () => runs++, hours: 3, clock });
	timer.start();
	timer.pause();
	timer.restart(6);
	clock.tick();
	assert.equal(runs, 0);
	timer.resume();
	clock.tick();
	assert.equal(runs, 1);
});
