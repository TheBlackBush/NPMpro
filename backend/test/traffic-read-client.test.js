import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import { createReadClient } from "../lib/traffic/read-client.js";

// a stand-in worker that answers each message on the next tick
const fakeWorkers = (answer) => {
	const started = [];
	const createWorker = (_file, { workerData }) => {
		const worker = new EventEmitter();
		worker.workerData = workerData;
		worker.unref = () => {};
		worker.terminate = async () => worker.emit("exit", 0);
		worker.postMessage = (message) => setImmediate(() => answer(worker, message));
		started.push(worker);
		return worker;
	};
	return { started, createWorker };
};

it("sends the reads to one worker and returns their results", async () => {
	const { started, createWorker } = fakeWorkers((worker, { id, fn, args }) =>
		worker.emit("message", { id, result: { fn, args } }),
	);
	const client = createReadClient({ filename: "/data/x.sqlite", createWorker });
	assert.deepEqual(await client.queryTraffic({ range: "30d" }), { fn: "queryTraffic", args: { range: "30d" } });
	assert.deepEqual(await client.summary({ now: 1 }), { fn: "summary", args: { now: 1 } });
	assert.equal(started.length, 1);
	assert.equal(started[0].workerData.filename, "/data/x.sqlite");
	await client.close();
});

it("rejects with the worker's error, and starts a new worker after one stopped", async () => {
	let crash = true;
	const { started, createWorker } = fakeWorkers((worker, { id }) => {
		if (crash) {
			crash = false;
			worker.emit("exit", 1);
			return;
		}
		worker.emit("message", { id, error: "no such table" });
	});
	const client = createReadClient({ filename: "/data/x.sqlite", createWorker });
	await assert.rejects(client.countVisitors({}), /stopped/u);
	await assert.rejects(client.countVisitors({}), /no such table/u);
	assert.equal(started.length, 2);
});
