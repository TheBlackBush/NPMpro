#!/usr/bin/env node

import { chmod, chown, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import app from "./app.js";
import { internalBackupSchedules } from "./internal/backup-service.js";
import { registerMoveWriter } from "./internal/database-service.js";
import { stopMonitoringServices } from "./internal/monitoring-services.js";
import { createBackupScheduler } from "./lib/backup/scheduler.js";
import { startupRetryLog } from "./lib/config.js";
import { workerGid } from "./lib/secret-file.js";
import { global as logger } from "./logger.js";
import { migrateUp } from "./migrate.js";
import { prepareApp } from "./startup.js";

// the backup scheduler is created once, a startup retry calls appStart again
let backupScheduler = null;
// a database move pauses it; registered once
let moveWriterRegistered = false;

async function appStart() {
	let reached = false;
	try {
		await migrateUp();
		reached = true;
		startupRetryLog.connected();
		await prepareApp();

		// scheduled backups, once every startup step that can fail has passed (a retry cleans the backup folder);
		// the first tick 5 minutes after the start runs overdue schedules once
		backupScheduler ??= createBackupScheduler({
			dueSchedules: internalBackupSchedules.dueSchedules,
			runAutomatic: internalBackupSchedules.runAutomatic,
			giveUp: internalBackupSchedules.giveUp,
			log: logger,
		});
		if (!moveWriterRegistered) {
			registerMoveWriter({
				name: "Backup scheduler",
				pause: (options) => backupScheduler.pause(options),
				resume: () => backupScheduler.resume(),
			});
			moveWriterRegistered = true;
		}
		backupScheduler.start();

		await rm("/run/npmpro.sock", { force: true });
		const server = app.listen("/run/npmpro.sock", async (err) => {
			if (err) throw err;
			// the unprivileged nginx workers (start.sh) may connect, other users may not
			if (workerGid() !== null) {
				await chown("/run/npmpro.sock", 0, workerGid());
				await chmod("/run/npmpro.sock", 0o660);
			}
			logger.info(`Backend PID ${process.pid} listening on unix socket...`);

			process.on("SIGTERM", () => {
				logger.info(`PID ${process.pid} received SIGTERM`);
				const stopped = Promise.race([stopMonitoringServices(), sleep(5000)]);
				server.close(async () => {
					await stopped;
					logger.info("Stopping.");
					process.exit(0);
				});
			});
		});
		// the default 300 s limit on receiving a request would cut off a backup upload (up to 2 GiB) on a slow link. A long
		// limit is safe only because nginx buffers the body of every other route (at most 1m) and just the upload location
		// streams it. The header timeout stays.
		server.requestTimeout = 3 * 60 * 60 * 1000;
	} catch (err) {
		// the first failure in full, then a short line every 30 s while it repeats (lib/retry-log.js)
		startupRetryLog.failed(err.message, () => logger.error(`Startup Error: ${err.message}`, err), { reached });
		setTimeout(appStart, 1000);
	}
}

try {
	await appStart();
} catch (err) {
	logger.fatal(err);
	process.exit(1);
}
