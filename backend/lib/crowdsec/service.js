import { readFile } from "node:fs/promises";
import { global as logger } from "../../logger.js";
import { CROWDSEC_CONF_PATH, isCrowdsecConfigured, parseCrowdsecConf } from "./config.js";
import { fetchDecisions, summariseDecisions } from "./decisions.js";

const POLL_MS = 60000;
// first seen time for the decisions of the first poll: they existed before, so they never count as added
const SEEDED = 0;

const readConfFile = async () => {
	try {
		return await readFile(CROWDSEC_CONF_PATH, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return "";
		throw err;
	}
};

const text = (v) => (typeof v === "string" ? v : String(v ?? ""));

/** Every newest item with all fields, also when the LAPI left one out (the schema requires them). */
const withCompleteNewest = (summary) => ({
	...summary,
	newest: summary.newest.map((d) => ({
		id: Number.isFinite(d.id) ? d.id : 0,
		value: text(d.value),
		scope: text(d.scope),
		scenario: text(d.scenario),
		origin: text(d.origin),
		type: text(d.type),
		duration: text(d.duration),
		seconds_left: d.seconds_left,
		country: d.country ?? null,
	})),
});

const emptySummary = () => summariseDecisions([], 0, null, new Map());

const defaultTimers = {
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (t) => clearInterval(t),
};

/**
 * Polls the active CrowdSec decisions every 60 s while the bouncer config is enabled and has credentials.
 * Keeps the last summary (also after a failed poll, with the error) and when each decision id was first seen:
 * the first poll after start (or after the config was off) seeds all ids so they do not count as added.
 *
 * @param   {Object}    [deps]
 * @param   {Function}  [deps.readConf]   () => Promise<string>  bouncer config text ("" when missing)
 * @param   {Function}  [deps.fetch]      (conf) => Promise<object[]>
 * @param   {Function}  [deps.geoLookup]  (ip) => country code | null
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.timers]
 * @returns {Object}
 */
const createCrowdsecService = ({
	readConf = readConfFile,
	fetch = (conf) => fetchDecisions(conf),
	geoLookup = () => null,
	now = Date.now,
	timers = defaultTimers,
	log = logger,
} = {}) => {
	const firstSeen = new Map();
	let seeded = false;
	let polling = null;
	let timer = null;
	let loggedError = null;
	let state = { configured: false, reachable: false, error: null, fetched_at: null, ...emptySummary() };

	const reset = (fields) => {
		firstSeen.clear();
		seeded = false;
		state = { reachable: false, error: null, fetched_at: null, ...emptySummary(), ...fields };
	};

	const remember = (list) => {
		const time = now();
		const ids = new Set();
		for (const d of list) {
			if (d && typeof d === "object" && d.id !== undefined) ids.add(d.id);
		}
		for (const id of firstSeen.keys()) {
			if (!ids.has(id)) firstSeen.delete(id);
		}
		for (const id of ids) {
			if (!firstSeen.has(id)) firstSeen.set(id, seeded ? time : SEEDED);
		}
		seeded = true;
	};

	const pollOnce = async () => {
		let conf;
		try {
			conf = parseCrowdsecConf(await readConf());
		} catch (err) {
			reset({ configured: false, error: `Could not read the CrowdSec config: ${err.message}` });
			return;
		}
		if (!isCrowdsecConfigured(conf)) {
			reset({ configured: false });
			return;
		}
		try {
			const list = await fetch(conf);
			remember(list);
			const time = now();
			state = {
				configured: true,
				reachable: true,
				error: null,
				fetched_at: new Date(time).toISOString(),
				...withCompleteNewest(summariseDecisions(list, time, geoLookup, firstSeen)),
			};
			loggedError = null;
		} catch (err) {
			const error = err?.message || String(err);
			// keep the last list, so the page still shows it with its fetched_at
			state = { ...state, configured: true, reachable: false, error };
			if (error !== loggedError) log.warn(`CrowdSec decisions: ${error}`);
			loggedError = error;
		}
	};

	/** One poll; a poll still running is shared instead of starting a second one. */
	const poll = () => {
		polling ??= pollOnce()
			.catch((err) => log.error(`CrowdSec decisions: ${err.message}`))
			.finally(() => {
				polling = null;
			});
		return polling;
	};

	return {
		start: () => {
			if (timer) return;
			const run = () => {
				poll().catch((err) => log.error(`CrowdSec decisions: ${err?.message ?? err}`));
			};
			timer = timers.setInterval(run, POLL_MS);
			timer?.unref?.();
			run();
		},
		stop: () => {
			if (timer) timers.clearInterval(timer);
			timer = null;
		},
		poll,
		/** The last result: { configured, reachable, error, fetched_at, total, added_24h, by_*, newest, countries } */
		result: () => state,
	};
};

export { createCrowdsecService };
