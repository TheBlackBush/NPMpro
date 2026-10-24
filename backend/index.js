#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import app from "./app.js";
import internalCertificate from "./internal/certificate.js";
import internalIpRanges from "./internal/ip_ranges.js";
import {
	runGeoipUpdate,
	startMonitoringServices,
	stopMonitoringServices,
	traffic,
} from "./internal/monitoring-services.js";
import { setMonitoringHooks } from "./internal/monitoring-setting.js";
import internalNginx from "./internal/nginx.js";
import { proxyHostsUsingDefault, renderRuntimeHosts } from "./internal/runtime-hosts.js";
import { setRuntimeApply } from "./internal/runtime-setting.js";
import { geoip } from "./lib/geoip/instance.js";
import { getMonitoringConfig } from "./lib/monitoring-config.js";
import { createRuntimeApplier } from "./lib/runtime-apply.js";
import { loadRuntimeConfig } from "./lib/runtime-config.js";
import { applyAccessLog } from "./lib/traffic/access-log.js";
import { createTrafficHooks } from "./lib/traffic/service.js";
import { global as logger } from "./logger.js";
import { migrateUp } from "./migrate.js";
import certificateModel from "./models/certificate.js";
import { getCompiledSchema } from "./schema/index.js";
import setup from "./setup.js";

async function appStart() {
	try {
		await migrateUp();

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
		});
		setRuntimeApply(runtimeApplier.applyGroup);
		// a failed startup apply keeps the files from start.sh, the backend still starts
		try {
			await loadRuntimeConfig();
			await runtimeApplier.applyAll();
		} catch (err) {
			logger.error(`Could not apply the runtime settings at startup: ${err.message}`);
		}

		await setup();
		await getCompiledSchema();

		internalCertificate.initTimer();

		setMonitoringHooks({
			runGeoipUpdate,
			onGeoipCredentialsChange: runGeoipUpdate,
			...createTrafficHooks({
				applyAccessLog: (enabled) =>
					applyAccessLog(enabled, { test: internalNginx.test, reload: internalNginx.reload }),
				traffic,
			}),
		});
		await geoip.reload();
		// start.sh writes the include from env only (LOGROTATE or TRAFFIC_STATS), the reload below picks up the stored setting
		const { values: monitoring } = await getMonitoringConfig();
		await applyAccessLog(monitoring.traffic_enabled, { writeOnly: true });
		await internalNginx.reload();
		startMonitoringServices();

		await rm("/run/npmpro.sock", { force: true });
		const server = app.listen("/run/npmpro.sock", (err) => {
			if (err) throw err;
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
