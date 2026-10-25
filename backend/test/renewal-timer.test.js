import assert from "node:assert/strict";
import { it } from "node:test";
import { createRenewalTimer } from "../lib/renewal-timer.js";

const HOUR = 3_600_000;

const fakeClock = () => {
	let next = 1;
	const active = new Map();
	return {
		active,
		setInterval: (_fn, ms) => {
			const id = next++;
			active.set(id, ms);
			return id;
		},
		clearInterval: (id) => active.delete(id),
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
