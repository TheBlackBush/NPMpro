#!/usr/bin/env node

import { rm } from "node:fs/promises";
import app from "./app.js";
import internalCertificate from "./internal/certificate.js";
import internalIpRanges from "./internal/ip_ranges.js";
import { setMonitoringHooks } from "./internal/monitoring-setting.js";
import internalNginx from "./internal/nginx.js";
import { getMonitoringConfig } from "./lib/monitoring-config.js";
import { applyAccessLog } from "./lib/traffic/access-log.js";
import { global as logger } from "./logger.js";
import { migrateUp } from "./migrate.js";
import { getCompiledSchema } from "./schema/index.js";
import setup from "./setup.js";

async function appStart() {
	try {
		await migrateUp();
		await setup();
		await getCompiledSchema();

		await internalIpRanges.generateConfig([]);
		if (process.env.TRUST_CLOUDFLARE !== "true") {
			logger.info("Cloudflares IPs are NOT trusted");
		} else {
			logger.info("Cloudflares IPs are trusted");
			internalIpRanges.initTimer();
			await internalIpRanges.fetch();
		}
		internalCertificate.initTimer();

		setMonitoringHooks({
			onTrafficEnabledChange: (enabled) =>
				applyAccessLog(enabled, { test: internalNginx.test, reload: internalNginx.reload }),
		});
		// start.sh writes the include from env only (LOGROTATE or TRAFFIC_STATS), the reload below picks up the stored setting
		const { values: monitoring } = await getMonitoringConfig();
		await applyAccessLog(monitoring.traffic_enabled, { writeOnly: true });
		await internalNginx.reload();

		await rm("/run/npmpro.sock", { force: true });
		const server = app.listen("/run/npmpro.sock", (err) => {
			if (err) throw err;
			logger.info(`Backend PID ${process.pid} listening on unix socket...`);

			process.on("SIGTERM", () => {
				logger.info(`PID ${process.pid} received SIGTERM`);
				server.close(() => {
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
