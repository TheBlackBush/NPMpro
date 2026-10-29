import db from "../db.js";
import { isSqlite, sqliteFile } from "../lib/config.js";
import { createCrowdsecService } from "../lib/crowdsec/service.js";
import { MOVE_PAUSE_MS, waitWithin } from "../lib/database/pause.js";
import { GEOIP_DIR, geoip } from "../lib/geoip/instance.js";
import { geoipUpdateSettled, runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { createGeoipService } from "../lib/geoip/service.js";
import { getGeoipConfig, getMonitoringConfig } from "../lib/monitoring-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { createReadClient } from "../lib/traffic/read-client.js";
import { createStateMeta, createTrafficService } from "../lib/traffic/service.js";
import {
	countVisitors,
	deleteAll,
	deleteIps,
	deletePaths,
	deleteVisitors,
	flush,
	pathDayHashes,
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

/**
 * All proxy, redirection and 404 hosts with their domain names (streams have no HTTP access log), with enabled
 * (missing pages of disabled hosts are not counted).
 */
const loadHosts = async () => {
	const knex = db();
	const hosts = [];
	for (const [type, table] of HOST_TABLES) {
		for (const row of await knex(table).select("id", "domain_names", "enabled").orderBy("id")) {
			hosts.push({
				id: Number(row.id),
				type,
				domain_names: parseNames(row.domain_names),
				enabled: Boolean(Number(row.enabled)),
			});
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
	deletePaths,
	// on SQLite the read worker's read-only connection runs the 48 hour scan, elsewhere the shared pool
	pathDayHashes: (args) => monitoringReads().pathDayHashes(args),
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
	reads ??= isSqlite()
		? createReadClient({ filename: sqliteFile() })
		: { queryTraffic, summary, countVisitors, pathDayHashes };
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

/**
 * A database move: the monitoring writes stop. The GeoIP checks skip and an update that is going on (also one
 * started by saving the GeoIP settings) records its result first; the traffic counts and reader position read so far
 * are written, then the flushes and roll-ups skip (the access log is still read). The timers keep running and the
 * CrowdSec poll goes on (it writes no database rows). With a writer still busy after timeoutMs it rejects with
 * "writer-running" and leaves everything as it was.
 *
 * @param {{ timeoutMs?: number }} [options]
 */
const pauseMonitoringWriters = async ({ timeoutMs = MOVE_PAUSE_MS } = {}) => {
	geoipService.pause();
	const [geo, counts] = await Promise.allSettled([
		waitWithin(geoipUpdateSettled(), { name: "GeoIP update", timeoutMs }),
		traffic.pause({ timeoutMs }),
	]);
	if (geo.status === "fulfilled" && counts.status === "fulfilled") return;
	geoipService.resume();
	if (counts.status === "fulfilled") traffic.resume();
	throw geo.status === "rejected" ? geo.reason : counts.reason;
};

/** After a failed database move: the GeoIP checks and the traffic writes go on from where they were. */
const resumeMonitoringWriters = () => {
	geoipService.resume();
	traffic.resume();
};

export {
	internalMonitoring,
	pauseMonitoringWriters,
	resumeMonitoringWriters,
	runGeoipUpdate,
	startMonitoringServices,
	stopMonitoringServices,
	traffic,
};
