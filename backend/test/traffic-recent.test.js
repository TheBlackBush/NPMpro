import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRecent } from "../lib/traffic/recent.js";

const entry = (host, time, extra = {}) => ({
	time,
	host,
	method: "GET",
	path: "/",
	status: 200,
	bytes: 10,
	country: null,
	...extra,
});

describe("recent requests", () => {
	it("keeps the newest 200 overall and lists them newest first, at most limit", () => {
		const recent = createRecent();
		for (let i = 0; i < 250; i++) recent.add(entry("a.test", i));
		const all = recent.list({ limit: 500 });
		assert.equal(all.length, 200);
		assert.equal(all[0].time, 249);
		assert.equal(all.at(-1).time, 50);
		assert.equal(recent.list().length, 100, "default limit");
		assert.deepEqual(
			recent.list({ limit: 3 }).map((e) => e.time),
			[249, 248, 247],
		);
	});

	it("keeps 50 per host, so a busy host cannot push a quiet host's entries out of its list", () => {
		const recent = createRecent();
		recent.add(entry("quiet.test", 1));
		recent.add(entry("quiet.test", 2));
		for (let i = 10; i < 400; i++) recent.add(entry("busy.test", i));
		assert.deepEqual(
			recent.list({ keys: ["quiet.test"] }).map((e) => e.time),
			[2, 1],
		);
		const busy = recent.list({ keys: ["busy.test"] });
		assert.equal(busy.length, 50);
		assert.equal(busy[0].time, 399);
		assert.ok(
			recent.list({ limit: 200 }).every((e) => e.host === "busy.test"),
			"overall list only has the newest",
		);
	});

	it("merges several keys newest first, same times in arrival order, and caps at limit", () => {
		const recent = createRecent({ overall: 10, perHost: 5 });
		recent.add(entry("a.test", 1));
		recent.add(entry("b.test", 3, { path: "/first" }));
		recent.add(entry("b.test", 3, { path: "/second" }));
		recent.add(entry("a.test", 2));
		recent.add(entry("c.test", 5));
		assert.deepEqual(
			recent.list({ keys: ["a.test", "b.test", "a.test"] }).map((e) => [e.host, e.path, e.time]),
			[
				["b.test", "/second", 3],
				["b.test", "/first", 3],
				["a.test", "/", 2],
				["a.test", "/", 1],
			],
		);
		assert.equal(recent.list({ keys: ["a.test", "b.test"], limit: 2 }).length, 2);
		assert.deepEqual(recent.list({ keys: ["unknown.test"] }), []);
		assert.deepEqual(recent.list({ keys: [] }), []);
	});

	it("returns copies without internal fields", () => {
		const recent = createRecent();
		recent.add(entry("a.test", 1, { ip: "203.0.113.7" }));
		const [first] = recent.list();
		assert.deepEqual(
			Object.keys(first).sort((a, b) => a.localeCompare(b)),
			["bytes", "country", "host", "ip", "method", "path", "status", "time"],
		);
		first.ip = "changed";
		assert.equal(recent.list()[0].ip, "203.0.113.7");
	});

	it("forgetIps drops the IP from every entry, also those only in a per host list", () => {
		const recent = createRecent({ overall: 2, perHost: 5 });
		recent.add(entry("quiet.test", 1, { ip: "203.0.113.1" }));
		recent.add(entry("busy.test", 2, { ip: "203.0.113.2" }));
		recent.add(entry("busy.test", 3, { ip: "203.0.113.3" }));
		recent.forgetIps();
		for (const keys of [null, ["quiet.test"], ["busy.test"]]) {
			for (const e of recent.list({ keys })) assert.equal("ip" in e, false);
		}
		assert.equal(JSON.stringify(recent.list({ keys: ["quiet.test", "busy.test"] })).includes("203.0.113"), false);
	});

	it("clear empties every list", () => {
		const recent = createRecent();
		recent.add(entry("a.test", 1));
		recent.clear();
		assert.deepEqual(recent.list(), []);
		assert.deepEqual(recent.list({ keys: ["a.test"] }), []);
		recent.add(entry("a.test", 2));
		assert.equal(recent.list().length, 1);
	});
});
