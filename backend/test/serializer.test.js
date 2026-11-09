import assert from "node:assert/strict";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createSerializer } from "../lib/serializer.js";

it("runs functions one after another, also after a failure, and gives each caller its own answer", async () => {
	const serialize = createSerializer();
	const order = [];
	const a = serialize(async () => {
		await sleep(5);
		order.push("a");
		throw new Error("a failed");
	});
	const b = serialize(() => {
		order.push("b");
		return "b done";
	});
	await assert.rejects(a, /a failed/u);
	assert.equal(await b, "b done");
	assert.deepEqual(order, ["a", "b"]);
});

it("passes no argument on from the function before", async () => {
	const serialize = createSerializer();
	await serialize(() => "first");
	assert.equal(await serialize((...args) => args.length), 0);
});

it("keeps one queue per key: a key waits only for itself", async () => {
	const serialize = createSerializer();
	const order = [];
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	const slow = serialize(async () => {
		await held;
		order.push("a1");
	}, "a");
	const next = serialize(() => order.push("a2"), "a");
	await serialize(() => order.push("b1"), "b");
	assert.deepEqual(order, ["b1"]);
	release();
	await Promise.all([slow, next]);
	assert.deepEqual(order, ["b1", "a1", "a2"]);
});

it("does not keep a key after its last function ended", async () => {
	const serialize = createSerializer();
	await serialize(() => {}, "gone");
	await new Promise(setImmediate);
	assert.equal(serialize.size(), 0);
});
