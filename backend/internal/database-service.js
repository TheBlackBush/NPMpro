import knexFactory from "knex";
import db from "../db.js";
import { getDatabaseInfo } from "../lib/config.js";
import { DATA_DIR, writeConnectionFile } from "../lib/database/connection-file.js";
import { maintenance } from "../lib/database/maintenance.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { closeSessions, peekHeldRevocations, writeHeldRevocations } from "../lib/session.js";
import { global as logger } from "../logger.js";
import internalAuditLog from "./audit-log.js";
import internalBackup from "./backup-service.js";
import internalCertificate from "./certificate.js";
import { createDatabaseService } from "./database.js";
import { pauseMonitoringWriters, resumeMonitoringWriters } from "./monitoring-services.js";

// what writes to the database in the background; a move pauses them in this order (each with the move's time limit)
// and resumes them in reverse. The renewals are paused from outside the runtime queue: a running renewal queues its
// stapling recovery there.
const writers = [
	{
		name: "Certificate renewals",
		pause: internalCertificate.pauseRenewals,
		resume: internalCertificate.resumeRenewals,
	},
	{ name: "Monitoring", pause: pauseMonitoringWriters, resume: resumeMonitoringWriters },
];

// index.js registers the backup scheduler, which it creates
const registerMoveWriter = (writer) => {
	writers.push(writer);
};

// a SIGTERM that does not end the process in time (a connection that never closes) still ends it
const EXIT_LIMIT_MS = 15_000;

const internalDatabase = createDatabaseService({
	knex: db(),
	current: getDatabaseInfo,
	createKnex: knexFactory,
	box: defaultSecretBox,
	dataDir: DATA_DIR,
	backup: internalBackup,
	writers: () => writers,
	maintenance,
	revocations: { held: peekHeldRevocations, write: writeHeldRevocations, close: closeSessions },
	audit: (access, data) => internalAuditLog.add(access, data),
	writeFile: writeConnectionFile,
	// the SIGTERM handler closes the server and stops the monitoring timers; dinit (restart = yes) starts it again
	exit: () => {
		setTimeout(() => process.exit(0), EXIT_LIMIT_MS).unref();
		process.kill(process.pid, "SIGTERM");
	},
	log: logger,
});

export { registerMoveWriter };
export default internalDatabase;
