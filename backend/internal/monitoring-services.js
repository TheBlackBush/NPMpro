import db from "../db.js";
import { createCrowdsecService } from "../lib/crowdsec/service.js";
import { GEOIP_DIR, geoip } from "../lib/geoip/instance.js";
import { runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { getGeoipConfig, getMonitoringConfig } from "../lib/monitoring-config.js";
import { createTrafficService } from "../lib/traffic/service.js";
import { deleteIps, flush, queryTraffic, rollUpAndPrune, summary } from "../lib/traffic/store.js";
import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { createMonitoring } from "./monitoring.js";
import internalMonitoringSetting from "./monitoring-setting.js";

const STATE_ID = "traffic-state";
const HOST_TABLES = ["proxy_host", "redirection_host", "dead_host"];

const parseNames = (raw) => {
	if (Array.isArray(raw)) return raw;
	try {
		const names = JSON.parse(raw ?? "[]");
		return Array.isArray(names) ? names : [];
	} catch {
		return [];
	}
};

/** Domain names of all proxy, redirection and 404 hosts (streams have no HTTP access log). */
const loadHosts = async () => {
	const knex = db();
	const names = [];
	for (const table of HOST_TABLES) {
		for (const row of await knex(table).select("domain_names")) names.push(...parseNames(row.domain_names));
	}
	return names;
};

const loadState = async () => {
	const meta = (await settingModel.query().where("id", STATE_ID).first())?.meta;
	return Number.isFinite(meta?.inode) && Number.isFinite(meta?.offset)
		? { inode: meta.inode, offset: meta.offset }
		: null;
};

const saveState = async ({ inode, offset }) => {
	const meta = { inode, offset };
	const existing = await settingModel.query().where("id", STATE_ID).first();
	if (existing) {
		await settingModel.query().where("id", STATE_ID).patch({ meta });
	} else {
		await settingModel.query().insert({
			id: STATE_ID,
			name: "Traffic state",
			description: "Access log reader position",
			value: STATE_ID,
			meta,
		});
	}
};

/** Runs the GeoIP update with the configured credentials and stores the outcome in the settings row. */
const runGeoipUpdate = () =>
	runConfiguredGeoipUpdate({
		geoip,
		dir: GEOIP_DIR,
		getConfig: getGeoipConfig,
		recordResult: (result) => internalMonitoringSetting.recordGeoipResult(result),
	});

const store = { flush, rollUpAndPrune, deleteIps, queryTraffic, summary };

const traffic = createTrafficService({
	store,
	geo: geoip,
	getConfig: getMonitoringConfig,
	loadState,
	saveState,
	loadHosts,
});

const crowdsec = createCrowdsecService({ geoLookup: (ip) => geoip.lookup(ip)?.country ?? null });

const geoipService = createGeoipService({ geoip, runUpdate: runGeoipUpdate, getConfig: getGeoipConfig });

const internalMonitoring = createMonitoring({ traffic, crowdsec, geoip, store, getConfig: getMonitoringConfig });

/** Starts the monitoring timers in the background; a failure is logged and never stops the backend. */
const startMonitoringServices = () => {
	geoipService.start();
	crowdsec.start();
	traffic.start().catch((err) => logger.error(`Traffic statistics could not start: ${err.message}`));
};

/** Stops all monitoring timers and writes the counts that are still in memory. */
const stopMonitoringServices = async () => {
	geoipService.stop();
	crowdsec.stop();
	try {
		await traffic.stop();
	} catch (err) {
		logger.error(`Traffic statistics could not stop cleanly: ${err.message}`);
	}
};

export { internalMonitoring, runGeoipUpdate, startMonitoringServices, stopMonitoringServices, traffic };
