import db from "../db.js";
import { createNotifyService } from "../lib/notify/service.js";
import { global as logger } from "../logger.js";

// The notification layer of the running app, over the real database. Before initNotify() no worker runs, but
// emit() still queues (a pending row waits for the worker).

const service = createNotifyService({ knex: db(), log: logger });
const {
	notify,
	sweep,
	stateStore,
	worker,
	registerSweepCheck,
	initNotify,
	pauseNotify,
	resumeNotify,
	cleanupAfterRestore,
} = service;

export {
	cleanupAfterRestore,
	initNotify,
	notify,
	pauseNotify,
	registerSweepCheck,
	resumeNotify,
	stateStore,
	sweep,
	worker,
};
