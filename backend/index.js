#!/usr/bin/env node

import { chmod, chown, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import app from "./app.js";
import { backupStore } from "./internal/backup-service.js";
import internalCertificate from "./internal/certificate.js";
import internalIpRanges from "./internal/ip_ranges.js";
import {
	internalMonitoring,
	runGeoipUpdate,
	startMonitoringServices,
	stopMonitoringServices,
	traffic,
} from "./internal/monitoring-services.js";
import { setMonitoringHooks } from "./internal/monitoring-setting.js";
import internalNginx from "./internal/nginx.js";
import { proxyHostsUsingDefault, renderRuntimeHosts } from "./internal/runtime-hosts.js";
import { runtimeExclusive } from "./internal/runtime-queue.js";
import { setRuntimeApply, setRuntimeApplyAll } from "./internal/runtime-setting.js";
import { recoverStapling, watchOcspResponses } from "./internal/stapling-recovery.js";
import { geoip } from "./lib/geoip/instance.js";
import { getMonitoringConfig } from "./lib/monitoring-config.js";
import { createRuntimeApplier } from "./lib/runtime-apply.js";
import { getRuntimeConfig, loadRuntimeConfig } from "./lib/runtime-config.js";
import { workerGid } from "./lib/secret-file.js";
import { applyAccessLog, createAccessLogSwitch } from "./lib/traffic/access-log.js";
import { createTrafficHooks } from "./lib/traffic/service.js";
import { global as logger } from "./logger.js";
import { migrateUp } from "./migrate.js";
import certificateModel from "./models/certificate.js";
import { getCompiledSchema } from "./schema/index.js";
import setup from "./setup.js";

async function appStart() {
	try {
		await migrateUp();
		// restore stages, unfinished writes and pending downloads of the previous run
		try {
			await backupStore.cleanup();
		} catch (err) {
			logger.warn(`Could not clean up the backup folder: ${err.message}`);
		}

		// the http access log is on while traffic statistics or Write log files is on
		const accessLog = createAccessLogSwitch({
			readTrafficEnabled: async () => (await getMonitoringConfig()).values.traffic_enabled,
			readWriteLogFiles: async () => (await getRuntimeConfig("logs")).values.write_log_files,
			apply: (enabled) => applyAccessLog(enabled, { test: internalNginx.test, reload: internalNginx.reload }),
			exclusive: runtimeExclusive,
		});
		const runtimeApplier = createRuntimeApplier({
			nginx: { test: internalNginx.test, reload: internalNginx.reload },
			renderHosts: renderRuntimeHosts,
			timers: { restartRenewal: internalCertificate.restartTimer },
			// an mTLS CA certificate cannot serve as the default certificate
			listCertificates: () => certificateModel.query().select("id").whereNot("provider", "mtls"),
			ocsp: { fetch: internalNginx.fetchOcsp },
			// ip_ranges.conf and the Cloudflare refresh timer (network settings, also at startup)
			ipRanges: internalIpRanges,
			// a forward-auth default cannot be cleared while proxy hosts rely on it
			proxyHostsUsingDefault,
			// the logs settings write the access log include too
			accessLogOn: accessLog.enabled,
		});
		setRuntimeApply(runtimeApplier.applyGroup);
		setRuntimeApplyAll(runtimeApplier.applyAll);
		// a failed startup apply keeps the files from start.sh, the backend still starts
		try {
			await loadRuntimeConfig();
			await runtimeApplier.applyAll();
		} catch (err) {
			logger.error(`Could not apply the runtime settings at startup: ${err.message}`);
		}

		await setup();
		// configs written while their OCSP response was missing staple once it arrives (also later fetches)
		watchOcspResponses();
		await recoverStapling();
		await getCompiledSchema();

		internalCertificate.initTimer();

		setMonitoringHooks({
			runGeoipUpdate,
			onGeoipCredentialsChange: runGeoipUpdate,
			...createTrafficHooks({
				applyAccessLog: accessLog.onTrafficEnabledChange,
				traffic,
				clearCaches: internalMonitoring.clearCaches,
			}),
		});
		await geoip.reload();
		await internalNginx.reload();
		startMonitoringServices();

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
	} catch (err) {
		logger.error(`Startup Error: ${err.message}`, err);
		setTimeout(appStart, 1000);
	}
}

try {
	await appStart();
} catch (err) {
	logger.fatal(err);
	process.exit(1);
}
