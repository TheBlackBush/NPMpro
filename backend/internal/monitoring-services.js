import db from "../db.js";
import { isSqlite, sqliteFile } from "../lib/config.js";
import { createCrowdsecService } from "../lib/crowdsec/service.js";
import { GEOIP_DIR, geoip } from "../lib/geoip/instance.js";
import { runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { getGeoipConfig, getMonitoringConfig } from "../lib/monitoring-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { createReadClient } from "../lib/traffic/read-client.js";
import { createStateMeta, createTrafficService } from "../lib/traffic/service.js";
import {
	countVisitors,
	deleteAll,
	deleteIps,
	deleteVisitors,
	flush,
	queryTraffic,
	rollUpAndPrune,
	summary,
	visitorDayHashes,
} from "../lib/traffic/store.js";
import { loadVisitorKey } from "../lib/traffic/visitor-hash.js";
import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import { createMonitoring } from "./monitoring.js";
import internalMonitoringSetting from "./monitoring-setting.js";

const STATE_ID = "traffic-state";
const HOST_TABLES = [
	["proxy", "proxy_host"],
	["redirection", "redirection_host"],
	["dead", "dead_host"],
];

const parseNames = (raw) => {
	if (Array.isArray(raw)) return raw;
	try {
		const names = JSON.parse(raw ?? "[]");
		return Array.isArray(names) ? names : [];
	} catch {
		return [];
	}
};

/** All proxy, redirection and 404 hosts with their domain names (streams have no HTTP access log). */
const loadHosts = async () => {
	const knex = db();
	const hosts = [];
	for (const [type, table] of HOST_TABLES) {
		for (const row of await knex(table).select("id", "domain_names").orderBy("id")) {
			hosts.push({ id: Number(row.id), type, domain_names: parseNames(row.domain_names) });
		}
	}
	return hosts;
};

/** Reader position and the encrypted visitor key, in the meta of one settings row. */
const stateMeta = createStateMeta({
	read: async () => (await settingModel.query().where("id", STATE_ID).first())?.meta,
	write: async (meta) => {
		const existing = await settingModel.query().where("id", STATE_ID).first();
		if (existing) {
			await settingModel.query().where("id", STATE_ID).patch({ meta });
		} else {
			await settingModel.query().insert({
				id: STATE_ID,
				name: "Traffic state",
				description: "Access log reader position and visitor key",
				value: STATE_ID,
				meta,
			});
		}
	},
});

/** Runs the GeoIP update with the configured credentials and stores the outcome in the settings row. */
const runGeoipUpdate = () =>
	runConfiguredGeoipUpdate({
		geoip,
		dir: GEOIP_DIR,
		getConfig: getGeoipConfig,
		recordResult: (result) => internalMonitoringSetting.recordGeoipResult(result),
	});

const store = {
	flush,
	rollUpAndPrune,
	deleteIps,
	deleteVisitors,
	deleteAll,
	visitorDayHashes,
	countVisitors,
	queryTraffic,
	summary,
};

const traffic = createTrafficService({
	store,
	geo: geoip,
	getConfig: getMonitoringConfig,
	loadState: stateMeta.loadState,
	saveState: stateMeta.saveState,
	loadHosts,
	loadVisitorKey: () =>
		loadVisitorKey({ readMeta: stateMeta.readMeta, writeMeta: stateMeta.writeMeta, box: defaultSecretBox }),
});

const crowdsec = createCrowdsecService({ geoLookup: (ip) => geoip.lookup(ip)?.country ?? null });

const geoipService = createGeoipService({ geoip, runUpdate: runGeoipUpdate, getConfig: getGeoipConfig });

// the statistics reads: on SQLite in a worker thread (a slow query would block the API), else on the shared pool
let reads = null;
const monitoringReads = () => {
	reads ??= isSqlite() ? createReadClient({ filename: sqliteFile() }) : { queryTraffic, summary, countVisitors };
	return reads;
};
const internalMonitoring = createMonitoring({
	traffic,
	crowdsec,
	geoip,
	store: {
		...store,
		queryTraffic: (args) => monitoringReads().queryTraffic(args),
		summary: (args) => monitoringReads().summary(args),
		countVisitors: (args) => monitoringReads().countVisitors(args),
	},
	getConfig: getMonitoringConfig,
});

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
	await reads?.close?.();
};

export { internalMonitoring, runGeoipUpdate, startMonitoringServices, stopMonitoringServices, traffic };
