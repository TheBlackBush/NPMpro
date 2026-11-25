import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCrowdsecService } from "../lib/crowdsec/service.js";

const MIN = 60_000;
const CONFIGURED = "ENABLED=true\nAPI_URL=http://lapi.test:8080\nAPI_KEY=lapi-key-secret-123\n";
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

const harness = ({ onState } = {}) => {
	const clock = { time: Date.parse("2026-11-25T10:00:00Z") };
	const control = { conf: CONFIGURED, down: false };
	const calls = [];
	const service = createCrowdsecService({
		readConf: () => Promise.resolve(control.conf),
		fetch: () =>
			control.down ? Promise.reject(new Error("CrowdSec request failed: ECONNREFUSED")) : Promise.resolve([]),
		now: () => clock.time,
		timers: { setInterval: () => 0, clearInterval: () => {} },
		log: quiet,
		onState: (change) => {
			calls.push(change);
			return onState?.(change);
		},
	});
	const poll = async (advance = MIN) => {
		clock.time += advance;
		await service.poll();
	};
	return { service, control, calls, poll, clock };
};

describe("crowdsec unreachable state", () => {
	it("tells bad after five minutes down, once reachable ok, and off when not configured", async () => {
		const h = harness();
		await h.poll();
		assert.deepEqual(h.calls, [{ state: "ok" }]);
		h.control.down = true;
		for (let minute = 0; minute <= 4; minute++) await h.poll();
		// the first failed poll started the clock: four minutes later nothing was told
		assert.deepEqual(h.calls, [{ state: "ok" }]);
		await h.poll();
		assert.equal(h.calls.length, 2);
		assert.equal(h.calls[1].state, "bad");
		assert.equal(h.calls[1].error, "CrowdSec request failed: ECONNREFUSED");
		assert.deepEqual(h.calls[1].secrets, ["lapi-key-secret-123"]);
		h.control.down = false;
		await h.poll();
		assert.deepEqual(h.calls.at(-1), { state: "ok" });
		// a quiet minute tells nothing again
		const told = h.calls.length;
		await h.poll();
		assert.equal(h.calls.length, told);
		h.control.conf = "ENABLED=false\n";
		await h.poll();
		assert.deepEqual(h.calls.at(-1), { state: "off" });
	});

	it("a recovery in between starts the five minutes again", async () => {
		const h = harness();
		h.control.down = true;
		for (let minute = 1; minute <= 4; minute++) await h.poll();
		h.control.down = false;
		await h.poll();
		h.control.down = true;
		for (let minute = 1; minute <= 4; minute++) await h.poll();
		assert.equal(h.calls.filter((call) => call.state === "bad").length, 0);
	});

	it("a callback that throws leaves the poll result", async () => {
		const h = harness({
			onState: () => {
				throw new Error("layer broke");
			},
		});
		await h.poll();
		assert.equal(h.service.result().reachable, true);
		h.control.down = true;
		for (let minute = 1; minute <= 6; minute++) await h.poll();
		assert.equal(h.service.result().reachable, false);
		assert.equal(h.service.result().error, "CrowdSec request failed: ECONNREFUSED");
	});
});
