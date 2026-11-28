import {
	fillCertificateServers,
	loadAcmeServer,
	sweepReplaceFolders,
	sweepRunFolders,
	syncAccountsWithFiles,
	syncEnvEmail,
} from "./internal/acme-account.js";
import { startExpirySweep } from "./internal/api-token.js";
import { backupStore } from "./internal/backup-service.js";
import internalCertificate from "./internal/certificate.js";
import { logCrowdsecBlock, setCrowdsecHooks, startCrowdsec } from "./internal/crowdsec-setting.js";
import { initDdnsTimer, restartDdnsTimer } from "./internal/ddns.js";
import { startGeoipNginx, syncGeoipConf } from "./internal/geoip-nginx.js";
import { applyGeoipProvider } from "./internal/geoip-provider.js";
import internalHostDnsRecord from "./internal/host-dns-record.js";
import internalIpRanges from "./internal/ip_ranges.js";
import { startLandingPages } from "./internal/landing-pages.js";
import { endInvitationsWhenOff, useMailSettings } from "./internal/mail-setting.js";
import {
	crowdsecService,
	internalMonitoring,
	runGeoipUpdate,
	startMonitoringServices,
	traffic,
} from "./internal/monitoring-services.js";
import { setMonitoringHooks } from "./internal/monitoring-setting.js";
import internalNginx from "./internal/nginx.js";
import { initNotify } from "./internal/notify.js";
import { proxyHostsUsingDefault, renderRuntimeHosts } from "./internal/runtime-hosts.js";
import { runtimeExclusive } from "./internal/runtime-queue.js";
import { setRuntimeApply, setRuntimeApplyAll } from "./internal/runtime-setting.js";
import { recoverStapling, watchOcspResponses } from "./internal/stapling-recovery.js";
import { getMonitoringConfig } from "./lib/monitoring-config.js";
import { createRuntimeApplier } from "./lib/runtime-apply.js";
import { getRuntimeConfig, loadRuntimeConfig } from "./lib/runtime-config.js";
import { applyAccessLog, createAccessLogSwitch } from "./lib/traffic/access-log.js";
import { createTrafficHooks } from "./lib/traffic/service.js";
import { global as logger } from "./logger.js";
import certificateModel from "./models/certificate.js";
import { getCompiledSchema } from "./schema/index.js";
import setup from "./setup.js";

/**
 * Everything the backend does between the migrations and listening. Tests call it with background off: no renewal
 * timer, monitoring services or file watcher.
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.background]  start the timers, services and watchers
 * @returns {Promise}
 */
const prepareApp = async ({ background = true } = {}) => {
	// the mail sender reads the saved mail settings (with the environment on top), not the environment alone
	useMailSettings();
	// invitations off by the env (or a row written while the app was down) end the links that are still out
	try {
		await endInvitationsWhenOff();
	} catch (err) {
		logger.warn(`Could not end the pending invitations: ${err.message}`);
	}
	// the stored instance CA first: every write of startup-settings.env below (and the runtime defaults) names it.
	// A failed read stops this pass (the caller retries) rather than write the file without the stored CA
	await loadAcmeServer();
	// run folders a crash left behind may hold an email or an EAB pair
	try {
		await sweepRunFolders();
	} catch (err) {
		logger.warn(`Could not remove old ACME run folders: ${err.message}`);
	}
	try {
		await sweepReplaceFolders();
	} catch (err) {
		logger.warn(`Could not remove old ACME replace folders: ${err.message}`);
	}

	// restore stages, unfinished writes and pending downloads of the previous run
	try {
		await backupStore.cleanup();
	} catch (err) {
		logger.warn(`Could not clean up the backup folder: ${err.message}`);
	}

	// Settings, Landing pages: the one import of the old CrowdSec pages, then the global page files. Before the first
	// config generation and reload (the runtime settings below), since the host configs and crowdsec.conf point at them
	await startLandingPages();
	// the GeoIP includes (country rules of access lists) before the first config generation, since the host configs
	// name their variables. startGeoipNginx writes passing variables when it cannot read the lists; a failure that is
	// left (a write error) keeps the files on disk, and host configs naming a variable they do not define go offline
	try {
		await startGeoipNginx();
	} catch (err) {
		logger.error(`Could not write the GeoIP includes at startup: ${err.message}`);
	}

	// the http access log is on while traffic statistics or Write log files is on
	const accessLog = createAccessLogSwitch({
		readTrafficEnabled: async () => (await getMonitoringConfig()).values.traffic_enabled,
		readWriteLogFiles: async () => (await getRuntimeConfig("logs")).values.write_log_files,
		readLogFormat: async () => (await getRuntimeConfig("logs")).values.log_format,
		apply: (enabled, format) =>
			applyAccessLog(enabled, { format, test: internalNginx.test, reload: internalNginx.reload }),
		exclusive: runtimeExclusive,
	});
	const runtimeApplier = createRuntimeApplier({
		nginx: { test: internalNginx.test, reload: internalNginx.reload },
		renderHosts: renderRuntimeHosts,
		timers: { restartRenewal: internalCertificate.restartTimer, restartDdns: restartDdnsTimer },
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

	try {
		await syncAccountsWithFiles();
		await fillCertificateServers();
	} catch (err) {
		logger.error(`Could not check the ACME accounts: ${err.message}`);
	}

	// CrowdSec (Settings, CrowdSec): the one-time import of a hand-edited crowdsec.conf, then the file and the two
	// includes from the row; the reload at the end loads them.
	const crowdsecStart = await startCrowdsec();

	await setup();
	// configs written while their OCSP response was missing staple once it arrives (also later fetches)
	if (background) watchOcspResponses();
	await recoverStapling();
	await getCompiledSchema();

	if (background) internalCertificate.initTimer();
	// a host's records whose host is gone (a restart during the host delete's job) are kept as orphans to clear
	if (background) {
		try {
			await internalHostDnsRecord.orphanHostless();
		} catch (err) {
			logger.error(`Could not check the host DNS records: ${err.message}`);
		}
	}
	// the first cycle runs a minute later; with no enabled record a cycle does nothing
	if (background) initDdnsTimer();
	if (background) startExpirySweep();
	if (background) await initNotify();
	if (background) void syncEnvEmail().catch((err) => logger.warn(`ACME email sync failed: ${err.message}`));

	// the status line of Settings, CrowdSec reads the reader's last poll; a save asks for a new poll
	setCrowdsecHooks({ result: () => crowdsecService.result(), onApplied: () => crowdsecService.poll() });
	setMonitoringHooks({
		runGeoipUpdate,
		onGeoipCredentialsChange: runGeoipUpdate,
		...createTrafficHooks({
			applyAccessLog: accessLog.onTrafficEnabledChange,
			traffic,
			clearCaches: internalMonitoring.clearCaches,
		}),
	});
	// geoip.conf is current since startGeoipNginx: no reload of its own, the one below loads it
	await applyGeoipProvider({ syncConf: () => syncGeoipConf({ reload: false }) });
	await internalNginx.reload();
	// the CrowdSec block of the startup log, after the reload that loaded the files; startup does not wait for its checks
	if (background) void logCrowdsecBlock(crowdsecStart);
	if (background) startMonitoringServices();
};

export { prepareApp };
