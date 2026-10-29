import { Worker } from "node:worker_threads";

const WORKER_FILE = new URL("./read-worker.js", import.meta.url);

/**
 * The monitoring reads of lib/traffic/store.js (queryTraffic, summary, countVisitors, pathDayHashes) run in a worker
 * thread with its own read-only SQLite connection, so a slow statistics query never blocks the API. The worker starts
 * on first use and again after it stopped; a call that was running when it stopped is rejected.
 *
 * @param   {Object}  options
 * @param   {String}  options.filename  the SQLite database
 * @param   {Function} [options.createWorker]  for tests
 * @returns {{queryTraffic: Function, summary: Function, countVisitors: Function, pathDayHashes: Function,
 *           close: Function}}
 */
const createReadClient = ({ filename, createWorker = (file, opts) => new Worker(file, opts) }) => {
	let worker = null;
	let nextId = 1;
	const pending = new Map();

	const failAll = (message) => {
		for (const { reject } of pending.values()) reject(new Error(message));
		pending.clear();
	};

	const start = () => {
		const started = createWorker(WORKER_FILE, { workerData: { filename } });
		started.on("message", ({ id, result, error }) => {
			const call = pending.get(id);
			if (!call) return;
			pending.delete(id);
			if (error === undefined) call.resolve(result);
			else call.reject(new Error(error));
		});
		started.on("error", (err) => {
			if (worker === started) worker = null;
			failAll(`Monitoring read failed: ${err.message}`);
		});
		started.on("exit", () => {
			if (worker === started) worker = null;
			failAll("Monitoring read stopped");
		});
		// an idle worker does not keep the process alive
		started.unref();
		return started;
	};

	const call = (fn) => (args) =>
		new Promise((resolve, reject) => {
			worker ??= start();
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ id, fn, args });
		});

	return {
		queryTraffic: call("queryTraffic"),
		summary: call("summary"),
		countVisitors: call("countVisitors"),
		pathDayHashes: call("pathDayHashes"),
		close: async () => {
			const running = worker;
			worker = null;
			if (running) await running.terminate();
		},
	};
};

export { createReadClient };
