import { createNotify } from "./index.js";
import { createQueue } from "./queue.js";
import { createStateStore } from "./state-store.js";
import { createSweep } from "./sweep.js";
import { createWorker } from "./worker.js";

// The notification layer over one database: store, queue, worker and sweep, the start, the pauses of a restore and
// a database move, and the cleanup after a restore. internal/notify.js builds the one of the running app.

const HOST_TABLES = [
	["proxy_host", "proxy_host"],
	["redirection_host", "redirection_host"],
	["dead_host", "dead_host"],
	["stream", "stream"],
];

const safeText = (error) => String(error?.message ?? error).slice(0, 200);

/**
 * @param   {Object}  options
 * @param   {Object}  options.knex
 * @param   {Object}  [options.log]
 * @param   {Object}  [options.clock]  { now() } in ms (tests)
 */
const createNotifyService = ({ knex, log, clock }) => {
	const stateStore = createStateStore({ knex, clock });
	const queue = createQueue({ knex, clock });
	const worker = createWorker({ queue, channels: () => notify.channels(), log });
	const notify = createNotify({ stateStore, queue, worker, log, clock });
	const sweepChecks = [];
	let initialised = false;
	const sweep = createSweep({ stateStore, queue, notify, checks: () => sweepChecks, log });

	return {
		notify,
		queue,
		stateStore,
		sweep,
		worker,

		/** Adds a check the hourly sweep runs first (the certificate expiry check) */
		registerSweepCheck: (check) => {
			sweepChecks.push(check);
		},

		/** At start: rows a stopped process left in sending go back to pending, then the worker and the sweep start */
		initNotify: async () => {
			// prepareApp is retried when a later step fails: only the first call resets rows, a second reset would
			// put a row that is being sent back to pending under the running worker
			if (initialised) return;
			initialised = true;
			try {
				await queue.resetSending();
			} catch (error) {
				log.warn(`notify: could not reset the sending rows: ${safeText(error)}`);
			}
			try {
				worker.start();
				sweep.start();
			} catch (error) {
				log.warn(`notify: could not start: ${safeText(error)}`);
			}
		},

		/** A restore or a database move: the worker and the sweep wait for what they are doing; { timeoutMs } */
		pauseNotify: async (options) => {
			await worker.pauseAndWait(options);
			try {
				await sweep.pause(options);
			} catch (error) {
				worker.resume();
				throw error;
			}
		},

		resumeNotify: () => {
			sweep.resume();
			worker.resume();
		},

		/** After a restore: the state rows of objects that no longer exist go away, without an event */
		cleanupAfterRestore: async () => {
			try {
				const ids = async (table) => (await knex(table).pluck("id")).map(String);
				const certificates = await ids("certificate");
				await stateStore.removeMissing("certificate.expiring", certificates);
				await stateStore.removeMissing("certificate.renewal_failed", certificates);
				const hosts = [];
				for (const [type, table] of HOST_TABLES) for (const id of await ids(table)) hosts.push(`${type}:${id}`);
				await stateStore.removeMissing("host.config_error", hosts);
				await stateStore.removeMissing("backup.failed", await ids("npmpro_backup_schedule"));
				const records = await ids("npmpro_ddns_record");
				await stateStore.removeMissing("ddns.record_failed", records);
				await stateStore.removeMissing("ddns.record_stopped", records);
			} catch (error) {
				log.warn(`notify: the cleanup after a restore failed: ${safeText(error)}`);
			}
		},
	};
};

export { createNotifyService };
