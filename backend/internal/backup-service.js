import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import db from "../db.js";
import { createBackupStore } from "../lib/backup/store.js";
import { geoip } from "../lib/geoip/instance.js";
import { clearDiscoveryCache } from "../lib/oidc-config.js";
import { loadRuntimeConfig } from "../lib/runtime-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { global as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import internalAuditLog from "./audit-log.js";
import { createBackupService } from "./backup.js";
import internalCertificate from "./certificate.js";
import internalNginx from "./nginx.js";
import {
	loadEnabledHosts,
	rebuildAccessListFiles,
	regenerateAllHostsNow,
	regenerateDefaultSite,
} from "./regenerate.js";
import { runtimeExclusive } from "./runtime-queue.js";
import { applyAllRuntime } from "./runtime-setting.js";

const KEY_FILE = process.env.NPMPRO_SECRET_KEY_FILE ?? "/data/npmpro/dns-credentials.key";

// the secret box key (created on its first use), which also derives the key of the automatic backups
const readInstanceKey = async () => {
	if (!existsSync(KEY_FILE)) defaultSecretBox.encrypt({});
	const key = await readFile(KEY_FILE);
	if (key.length !== 32) throw new Error(`Encryption key ${KEY_FILE} is invalid`);
	return key;
};

const backupStore = createBackupStore({ dir: "/data/backups" });

const internalBackup = createBackupService({
	knex: db(),
	box: defaultSecretBox,
	dataDir: "/data",
	store: backupStore,
	dbVersion: () => db().migrate.currentVersion({ tableName: "migrations", directory: "migrations" }),
	// set from .version when the image is built, like the version check
	npmproVersion: pjson.version,
	instanceKey: readInstanceKey,
	audit: (access, data) => internalAuditLog.add(access, data),
	nginx: internalNginx,
	renewals: { pause: internalCertificate.pauseRenewals, resume: internalCertificate.resumeRenewals },
	regenerate: { loadEnabledHosts, rebuildAccessListFiles, regenerateAllHostsNow, regenerateDefaultSite },
	runtime: { loadRuntimeConfig, applyAllRuntime },
	reloadSettings: { oidc: clearDiscoveryCache, monitoring: () => geoip.reload() },
	exclusive: runtimeExclusive,
	hostname: os.hostname(),
	log: logger,
});

export { backupStore };
export default internalBackup;
