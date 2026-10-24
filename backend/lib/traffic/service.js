import { setImmediate as yieldToLoop } from "node:timers/promises";
import { global as logger } from "../../logger.js";
import { createCounter } from "./counter.js";
import { createLogReader } from "./log-reader.js";
import { isOwnRequest, parseAlogLine } from "./parse.js";

const ACCESS_LOG = "/data/nginx/logs/access.log";
const OTHER_HOST = "_other";

const READ_MS = 5000;
const FLUSH_MS = 60000;
const MAINTAIN_MS = 3600000;
const MISSING_RETRY_MS = 60000;
// bytes per read and lines between event loop yields, so a catch-up after downtime does not block the backend
const READ_MAX_CHUNK = 8 * 1024 * 1024;
const YIELD_EVERY = 5000;
// how long counts are kept in memory while the database flush keeps failing
const PENDING_MAX_MS = 10 * 60000;
// after "show visitor IPs" was switched off, a stale stored true is ignored this long (the hook runs before the save)
const IPS_OFF_PIN_MS = 5 * 60000;

const defaultTimers = {
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (t) => clearInterval(t),
};

/**
 * Maps a request host to the host key that is stored: a managed domain name, the managed wildcard name it
 * matches (`*.example.com`, `.example.com`) or `_other` for everything else (default site, IPs, random names).
 * Storing the wildcard name instead of the real sub domain keeps the tables bounded.
 * Trailing wildcards (`www.example.*`) and regex names are not matched: their requests fall back to `_other`.
 * Every configured host counts as managed, also a disabled one (its requests reach the default site anyway).
 *
 * @param   {Iterable<string>}  domains  domain names of the managed hosts
 * @returns {(host: string) => string}
 */
const createHostMapper = (domains) => {
	const exact = new Set();
	const wildcards = [];
	for (const raw of domains) {
		const name = String(raw ?? "")
			.trim()
			.toLowerCase();
		if (name === "") continue;
		if (name.startsWith("*.")) {
			wildcards.push({ name, suffix: name.slice(1), self: null });
		} else if (name.startsWith(".")) {
			wildcards.push({ name, suffix: name, self: name.slice(1) });
		} else {
			exact.add(name);
		}
	}
	// longest suffix first, like nginx picks the longest matching wildcard
	wildcards.sort((a, b) => b.suffix.length - a.suffix.length);
	return (host) => {
		if (host && exact.has(host)) return host;
		if (host) {
			for (const w of wildcards) {
				if (host === w.self || (host.endsWith(w.suffix) && host.length > w.suffix.length)) return w.name;
			}
		}
		return OTHER_HOST;
	};
};

/**
 * Runs the given functions one after another, also when an earlier one failed (single database writer)
 */
const createQueue = () => {
	let chain = Promise.resolve();
	return (fn) => {
		const run = chain.then(fn, fn);
		chain = run.catch(() => {});
		return run;
	};
};

const sumRequests = (rows) => rows.reduce((n, r) => n + r.requests, 0);

const hasRows = (data) =>
	data.minutes.length > 0 || data.countries.length > 0 || data.asns.length > 0 || data.ips.length > 0;

const mergeBatches = (batches) => ({
	minutes: batches.flatMap((b) => b.minutes),
	countries: batches.flatMap((b) => b.countries),
	asns: batches.flatMap((b) => b.asns),
	ips: batches.flatMap((b) => b.ips),
});

/**
 * The traffic statistics pipeline: access log reader, parser, GeoIP, counter and store on timers.
 * Reads every 5 s while enabled, flushes every 60 s (and saves the reader position after a successful flush),
 * rolls up and prunes hourly. Failures never throw out of the timers: they are logged and exposed by status().
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.store        { flush, rollUpAndPrune, deleteIps } (lib/traffic/store.js)
 * @param   {Object}    deps.geo          { lookup(ip), available() } (lib/geoip/lookup.js)
 * @param   {Function}  deps.getConfig    () => Promise<{ values: { traffic_enabled, retention_days, show_ips } }>
 * @param   {Function}  deps.loadState    () => Promise<{ inode, offset } | null>
 * @param   {Function}  deps.saveState    (state) => Promise
 * @param   {Function}  deps.loadHosts    () => Promise<string[]>  domain names of the managed hosts
 * @param   {Function}  [deps.createReader]  (state) => { read() }
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.timers]     { setInterval, clearInterval }
 * @param   {number}    [deps.maxPerKey]
 * @param   {string}    [deps.adminPort]  NPM_PORT: requests to the admin UI and the health check are not counted
 * @returns {Object}
 */
const createTrafficService = ({
	store,
	geo,
	getConfig,
	loadState,
	saveState,
	loadHosts,
	createReader = (state) => createLogReader({ path: ACCESS_LOG, state, maxChunk: READ_MAX_CHUNK }),
	now = Date.now,
	timers = defaultTimers,
	maxPerKey = 1000,
	adminPort = process.env.NPM_PORT || "81",
	log = logger,
}) => {
	const queue = createQueue();
	const counter = createCounter({ maxPerKey });
	let mapHost = createHostMapper([]);

	let started = false;
	let enabled = false;
	// set by setEnabled() when the hook runs before start() finished
	let enabledBySwitch = null;
	// the settings could not be read in start(): the enabled state and the IP cleanup wait for the next refresh
	let startupPending = false;
	let showIps = false;
	let ipsOffUntil = 0;
	let retentionDays = 30;

	let reader = null;
	let readInFlight = null;
	let retryAt = 0;
	let lastState = null;
	let savedState = null;
	let pending = [];

	let readError = null;
	let flushError = null;
	let lastRead = null;
	let skipped = 0;
	let droppedRequests = 0;
	let loggedError = null;

	let readTimer = null;
	let flushTimer = null;
	let maintainTimer = null;

	const logOnce = (message) => {
		if (message !== loggedError) log.error(`Traffic statistics: ${message}`);
		loggedError = message;
	};

	const applyConfig = (values) => {
		retentionDays = values.retention_days;
		if (values.show_ips && now() < ipsOffUntil) return;
		if (!values.show_ips) ipsOffUntil = 0;
		showIps = Boolean(values.show_ips);
	};

	const logError = (what) => (err) => log.error(`Traffic statistics: ${what}: ${err?.message ?? err}`);

	/** The effective settings, or null when they cannot be read. */
	const loadConfig = async () => {
		try {
			const { values } = await getConfig();
			applyConfig(values);
			return values;
		} catch (err) {
			logError("could not read the settings")(err);
			return null;
		}
	};

	const refreshHosts = async () => {
		try {
			mapHost = createHostMapper(await loadHosts());
		} catch (err) {
			logError("could not read the host list")(err);
		}
	};

	const startReading = () => {
		if (readTimer) return;
		readTimer = timers.setInterval(() => {
			read().catch(logError("read failed"));
		}, READ_MS);
		readTimer?.unref?.();
	};

	const stopReading = () => {
		if (readTimer) timers.clearInterval(readTimer);
		readTimer = null;
	};

	/** Runs inside the queue after each flush: settings, the work start() could not do, and the host list. */
	const refresh = async () => {
		const values = await loadConfig();
		if (values && startupPending) {
			startupPending = false;
			if (enabledBySwitch === null && values.traffic_enabled) {
				enabled = true;
				startReading();
			}
			if (!showIps) await store.deleteIps().catch(logError("could not delete the stored IPs"));
		}
		// the host list is only needed while lines are counted
		if (enabled) await refreshHosts();
	};

	const addLine = (line) => {
		if (line === "" || isOwnRequest(line, adminPort)) return;
		const parsed = parseAlogLine(line);
		if (!parsed) {
			skipped++;
			return;
		}
		const { ip, ...rest } = parsed;
		const entry = { ...rest, host: mapHost(parsed.host) };
		if (showIps) entry.ip = ip;
		const available = geo.available();
		const found = available.country || available.asn ? geo.lookup(ip) : null;
		counter.add(entry, found, { showIps });
	};

	const readOnce = async () => {
		try {
			reader ??= createReader(lastState);
			const result = await reader.read();
			if (result.missing) {
				readError = `Access log ${ACCESS_LOG} not found`;
				retryAt = now() + MISSING_RETRY_MS;
				return;
			}
			readError = null;
			lastRead = now();
			skipped += result.dropped ?? 0;
			for (let i = 0; i < result.lines.length; i++) {
				if (i > 0 && i % YIELD_EVERY === 0) await yieldToLoop();
				addLine(result.lines[i]);
			}
			lastState = result.state;
		} catch (err) {
			readError = `Could not read the access log: ${err.message}`;
			retryAt = now() + MISSING_RETRY_MS;
			logOnce(readError);
		}
	};

	/** One read of the access log (every 5 s while enabled); a read still running is shared. */
	const read = () => {
		if (readInFlight || !enabled || now() < retryAt) return readInFlight ?? Promise.resolve();
		readInFlight = readOnce().finally(() => {
			readInFlight = null;
		});
		return readInFlight;
	};

	/** Moves the counter into the pending batches and writes them; on failure keeps them up to 10 minutes. */
	const flushNow = async () => {
		// a read that yields to the event loop must finish first, so the saved position matches the counts
		if (readInFlight) await readInFlight;
		const data = counter.drain();
		if (!showIps) data.ips = [];
		if (hasRows(data)) pending.push({ at: now(), data });
		const state = lastState;
		if (pending.length === 0) {
			flushError = null;
		} else {
			try {
				await store.flush(mergeBatches(pending.map((p) => p.data)));
				pending = [];
				flushError = null;
			} catch (err) {
				flushError = `Could not save the statistics: ${err.message}`;
				logOnce(flushError);
				const cutoff = now() - PENDING_MAX_MS;
				const old = pending.filter((p) => p.at <= cutoff);
				pending = pending.filter((p) => p.at > cutoff);
				droppedRequests += old.reduce((n, p) => n + sumRequests(p.data.minutes), 0);
				return;
			}
		}
		if (state && (savedState?.inode !== state.inode || savedState?.offset !== state.offset)) {
			try {
				await saveState(state);
				savedState = state;
			} catch (err) {
				log.error(`Traffic statistics: could not save the reader position: ${err.message}`);
			}
		}
	};

	const flush = () =>
		queue(async () => {
			await flushNow();
			await refresh();
		});

	const maintain = () =>
		queue(async () => {
			try {
				await store.rollUpAndPrune({ now: now(), retentionDays });
			} catch (err) {
				log.error(`Traffic statistics: roll-up failed: ${err.message}`);
			}
		});

	return {
		/** Loads the settings, reader position and hosts, removes stored IPs when they are off, starts the timers. */
		start: async () => {
			if (started) return;
			started = true;
			const values = await loadConfig();
			if (values === null) {
				startupPending = true;
			} else if (!showIps) {
				// covers TRAFFIC_SHOW_IPS=false set while IPs were stored; only when the setting is known to be off
				await queue(() => store.deleteIps()).catch(logError("could not delete the stored IPs"));
			}
			try {
				lastState = (await loadState()) ?? null;
				savedState = lastState;
			} catch (err) {
				log.error(`Traffic statistics: could not load the reader position: ${err.message}`);
			}
			if (!started) return;
			enabled = enabledBySwitch ?? Boolean(values?.traffic_enabled);
			if (enabled) {
				await refreshHosts();
				startReading();
			}
			flushTimer = timers.setInterval(() => {
				flush().catch(logError("flush failed"));
			}, FLUSH_MS);
			flushTimer?.unref?.();
			maintainTimer = timers.setInterval(() => {
				maintain().catch(logError("roll-up failed"));
			}, MAINTAIN_MS);
			maintainTimer?.unref?.();
			maintain().catch(logError("roll-up failed"));
		},

		/** Clears the timers and writes what is still counted. */
		stop: async () => {
			started = false;
			stopReading();
			for (const t of [flushTimer, maintainTimer]) if (t) timers.clearInterval(t);
			flushTimer = null;
			maintainTimer = null;
			await queue(flushNow);
		},

		/** Starts or stops reading the access log (the switch itself is done by applyAccessLog). */
		setEnabled: async (next) => {
			enabled = Boolean(next);
			enabledBySwitch = enabled;
			if (!started) return;
			if (enabled) {
				retryAt = 0;
				await queue(refreshHosts);
				startReading();
			} else {
				stopReading();
				readError = null;
				await queue(flushNow);
			}
		},

		/** Stops recording IPs at once, drops the counted ones and deletes again after a flush that was running. */
		showIpsOff: async () => {
			showIps = false;
			ipsOffUntil = now() + IPS_OFF_PIN_MS;
			counter.forgetIps();
			for (const p of pending) p.data.ips = [];
			await queue(() => store.deleteIps());
		},

		/** Records IPs again at once: the user switched them back on and the setting is saved. */
		showIpsOn: () => {
			ipsOffUntil = 0;
			showIps = true;
		},

		status: () => ({
			enabled,
			skipped_lines: skipped,
			dropped_requests: droppedRequests,
			last_read: lastRead === null ? null : new Date(lastRead).toISOString(),
			error: readError ?? flushError ?? null,
		}),

		// exposed for tests
		read,
		flush,
		maintain,
	};
};

/**
 * Settings hooks for the traffic switches: the access log include plus the reader.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.applyAccessLog  (enabled) => Promise, writes the include, tests and reloads nginx
 * @param   {Object}    deps.traffic         createTrafficService() instance
 * @returns {{onTrafficEnabledChange: Function, onShowIpsOff: Function, onShowIpsOn: Function}}
 */
const createTrafficHooks = ({ applyAccessLog, traffic }) => ({
	onTrafficEnabledChange: async (enabled) => {
		await applyAccessLog(enabled);
		await traffic.setEnabled(enabled);
	},
	onShowIpsOff: () => traffic.showIpsOff(),
	onShowIpsOn: () => traffic.showIpsOn(),
});

export { ACCESS_LOG, createHostMapper, createTrafficHooks, createTrafficService, OTHER_HOST };
