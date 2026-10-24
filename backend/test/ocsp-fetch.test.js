import assert from "node:assert/strict";
import { it } from "node:test";
import { createOcspFetcher, MIN_INTERVAL } from "../lib/ocsp-fetch.js";
import utils from "../lib/utils.js";

const counting = ({ hang = false, fail = false } = {}) => {
	const runs = [];
	let release;
	const run = (kind) => {
		runs.push(kind);
		if (fail) return Promise.reject(new Error("no responder"));
		if (!hang) return Promise.resolve();
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	return { runs, run, release: () => release?.() };
};

it("shares a running fetch: two renders without a .der run the fetcher once", async () => {
	const f = counting({ hang: true });
	const fetch = createOcspFetcher({ run: f.run });
	const first = fetch("acme");
	const second = fetch("acme");
	assert.equal(first, second);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(fetch("acme"), first);
	f.release();
	await Promise.all([first, second]);
	assert.deepEqual(f.runs, ["acme"]);
});

it("skips a fetch within 10 minutes of the last attempt, per kind, also after a failure", async () => {
	let clock = 1_000_000;
	const f = counting({ fail: true });
	const fetch = createOcspFetcher({ run: f.run, now: () => clock });
	await fetch("acme");
	clock += MIN_INTERVAL - 1;
	await fetch("acme");
	await fetch("custom");
	assert.deepEqual(f.runs, ["acme", "custom"]);
	clock += 1;
	await fetch("acme");
	assert.deepEqual(f.runs, ["acme", "custom", "acme"]);
	assert.equal(MIN_INTERVAL, 600_000);
});

it("cuts a hanging command at the execFile timeout", async () => {
	const started = Date.now();
	await assert.rejects(utils.execFile("sleep", ["5"], { timeout: 200 }), { name: "CommandError" });
	assert.ok(Date.now() - started < 3000);
});
