// Worker thread for the monitoring reads on SQLite (lib/traffic/read-client.js): better-sqlite3 is synchronous, so a
// long statistics query on the main thread would stop every other API request until it ends. This thread has its own
// read-only connection; WAL mode lets it read while the main thread writes.
import { parentPort, workerData } from "node:worker_threads";
import knexFactory from "knex";
import { createStore } from "./store.js";

const READS = new Set(["queryTraffic", "summary", "countVisitors"]);

const knex = knexFactory({
	client: "better-sqlite3",
	connection: { filename: workerData.filename, options: { readonly: true } },
	useNullAsDefault: true,
	pool: {
		min: 1,
		max: 1,
		afterCreate: (conn, done) => {
			conn.pragma("busy_timeout = 5000");
			done(null, conn);
		},
	},
});
const store = createStore(knex);

parentPort.on("message", async ({ id, fn, args }) => {
	try {
		if (!READS.has(fn)) throw new Error(`Unknown monitoring read ${fn}`);
		parentPort.postMessage({ id, result: await store[fn](args) });
	} catch (err) {
		parentPort.postMessage({ id, error: err.message });
	}
});
