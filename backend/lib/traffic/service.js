import { stat } from "node:fs/promises";
import { global as logger } from "../../logger.js";
import { waitWithin } from "../database/pause.js";
import { createSerializer } from "../serializer.js";
import { createAggregator } from "./aggregator.js";
import { createCounter } from "./counter.js";
import { createHostList, createHostMapper } from "./host-list.js";
import { createHostResolver } from "./host-resolver.js";
import { createLogReader } from "./log-reader.js";
import { ACCESS_LOG, createTrafficReader } from "./reader.js";
import { createRecent } from "./recent.js";
import { createVisitorHasher } from "./visitor-hash.js";

const READ_MS = 5000;
const FLUSH_MS = 60000;
const MAINTAIN_MS = 3600000;
// bytes per read, so a catch-up after downtime does not block the backend
const READ_MAX_CHUNK = 8 * 1024 * 1024;
// after "show visitor IPs" was switched off, a stale stored true is ignored this long (the hook runs before the save)
const IPS_OFF_PIN_MS = 5 * 60000;
// the same for count unique visitors
const VISITORS_OFF_PIN_MS = 5 * 60000;
const DAY = 86400000;
// the API reloads the host list when it is older than this (the flush reloads it every minute while counting)
const HOSTS_MAX_AGE_MS = 60000;
const VISITORS_KEY_ERROR = "Visitor counting is unavailable: the key could not be loaded";
const VISITORS_KEY_REPLACED =
	"The visitor key could not be read; a new key was created and stored visitor hashes were deleted";

const defaultTimers = {
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (t) => clearInterval(t),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (t) => clearTimeout(t),
};

/**
 * Reader position and visitor key share the meta of the `traffic-state` settings row. Each write reads the current meta
 * first and only replaces its own fields, so neither overwrites the other. `read()` gives the stored meta,
 * `write(meta)` stores the whole meta.
 */
const createStateMeta = ({ read, write }) => ({
	loadState: async () => {
		const meta = await read();
		return Number.isFinite(meta?.inode) && Number.isFinite(meta?.offset)
			? { inode: meta.inode, offset: meta.offset }
			: null;
	},
	saveState: async ({ inode, offset }) => {
		const meta = (await read()) ?? {};
		await write({ ...meta, inode, offset });
	},
	readMeta: read,
	/** For loadVisitorKey(): only `visitor_key` is taken from the given meta. */
	writeMeta: async ({ visitor_key }) => {
		const meta = (await read()) ?? {};
		await write({ ...meta, visitor_key });
	},
});

/**
 * The traffic statistics pipeline: access log reader, parser, GeoIP, counter and store on timers. Reads every 5 s while
 * enabled, flushes every 60 s (and saves the reader position after a successful flush), rolls up and prunes hourly.
 * Failures never throw out of the timers: they are logged and exposed by status(). The deps are the stores and loaders
 * (see test/monitoring-service.test.js); `loadVisitorKey`, `createReader`, `statLog`, `now` and `timers` are optional.
 */
const createTrafficService = ({
	store,
	geo,
	getConfig,
	loadState,
	saveState,
	loadHosts,
	loadVisitorKey = null,
	createReader = (state) => createLogReader({ path: ACCESS_LOG, state, maxChunk: READ_MAX_CHUNK }),
	statLog = () => stat(ACCESS_LOG),
	now = Date.now,
	timers = defaultTimers,
	maxPerKey = 1000,
	maxVisitors = 100000,
	adminPort = process.env.NPM_PORT || "81",
	bindAddresses = [process.env.NPM_IPV4_BINDING].filter((address) => address && address !== "0.0.0.0"),
	log = logger,
}) => {
	const queue = createSerializer();
	const counter = createCounter({ maxPerKey, maxVisitors });
	// the newest requests for the API, in memory only; IPs only while show_ips is on
	const recent = createRecent();

	// The state the parts share. Each value lives on one of these two objects and nowhere else, so the reader, the
	// aggregator and the methods below always see the same one.
	const settings = {
		enabled: false,
		showIps: false,
		ipsOffUntil: 0,
		uniqueVisitors: false,
		visitorsOffUntil: 0,
		// set from the visitor key in start(); null while no key could be loaded
		hashVisitor: null,
		retentionDays: 30,
		// a database move: nothing is written (the log is still read and counted in memory) until resume()
		paused: false,
	};
	const position = {
		lastState: null,
		savedState: null,
		// the position of counts that were written while saving it failed (cleared by the next save that works)
		unsavedState: null,
	};

	let started = false;
	// set by setEnabled() when the hook runs before start() finished
	let enabledBySwitch = null;
	// the settings could not be read in start(): the enabled state and the IP cleanup wait for the next refresh
	let startupPending = false;
	let visitorKeyFailed = false;
	let loggedError = null;
	let readTimer = null;
	let flushTimer = null;
	let maintainTimer = null;

	const logOnce = (message) => {
		if (message !== loggedError) log.error(`Traffic statistics: ${message}`);
		loggedError = message;
	};

	const logError = (what) => (err) => log.error(`Traffic statistics: ${what}: ${err?.message ?? err}`);

	const hostList = createHostList({ loadHosts, recent, now, logError });
	const reader = createTrafficReader({
		createReader,
		counter,
		recent,
		geo,
		hostList,
		settings,
		position,
		adminPort,
		bindAddresses,
		now,
		logOnce,
	});
	const aggregator = createAggregator({
		store,
		counter,
		saveState,
		statLog,
		settings,
		position,
		reader,
		now,
		log,
		logOnce,
		logError,
	});

	const applyConfig = (values) => {
		settings.retentionDays = values.retention_days;
		counter.setVisitorsCap(values.visitors_cap ?? maxVisitors);
		if (!(values.unique_visitors && now() < settings.visitorsOffUntil)) {
			if (!values.unique_visitors) settings.visitorsOffUntil = 0;
			settings.uniqueVisitors = Boolean(values.unique_visitors);
		}
		if (values.show_ips && now() < settings.ipsOffUntil) return;
		if (!values.show_ips) settings.ipsOffUntil = 0;
		if (settings.showIps && !values.show_ips) recent.forgetIps();
		settings.showIps = Boolean(values.show_ips);
	};

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

	const startReading = () => {
		if (readTimer) return;
		readTimer = timers.setInterval(() => {
			reader.read().catch(logError("read failed"));
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
				settings.enabled = true;
				startReading();
			}
			if (!settings.showIps) await store.deleteIps().catch(logError("could not delete the stored IPs"));
			if (!settings.uniqueVisitors) {
				// also the per day hashes seeded at start, they are the ones deleted here
				counter.forgetVisitors();
				await store.deleteVisitors().catch(logError("could not delete the stored visitor hashes"));
			}
		}
		// the host list is only needed while lines are counted
		if (settings.enabled) await hostList.refresh();
	};

	const flush = () =>
		queue(async () => {
			if (settings.paused) return;
			await aggregator.flushNow();
			await refresh();
		});

	const maintain = () =>
		queue(async () => {
			if (settings.paused) return;
			try {
				await store.rollUpAndPrune({ now: now(), retentionDays: settings.retentionDays });
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
			// once per start and inside the queue: two concurrent first loads would each create a key
			const keyCreated = await queue(async () => {
				if (!loadVisitorKey) return false;
				try {
					const { key, created, replaced } = await loadVisitorKey();
					settings.hashVisitor = createVisitorHasher(key);
					if (replaced) log.error(`Traffic statistics: ${VISITORS_KEY_REPLACED}`);
					return created;
				} catch (err) {
					visitorKeyFailed = true;
					logError("could not load the visitor key, unique visitors are not counted")(err);
					return false;
				}
			});
			// a new key cannot match the stored hashes; with the setting known to be off they are removed too
			if (keyCreated || (values !== null && !settings.uniqueVisitors)) {
				await queue(() => store.deleteVisitors()).catch(logError("could not delete the stored visitor hashes"));
			} else if (settings.hashVisitor) {
				// the per day cap counts the visitors stored before this start, returning ones only once
				await queue(async () => {
					const today = Math.floor(now() / DAY);
					counter.seedVisitors(await store.visitorDayHashes({ days: [today - 1, today] }));
				}).catch(logError("could not read the stored visitor hashes"));
			}
			if (values === null) {
				startupPending = true;
			} else if (!settings.showIps) {
				// covers TRAFFIC_SHOW_IPS=false set while IPs were stored; only when the setting is known to be off
				await queue(() => store.deleteIps()).catch(logError("could not delete the stored IPs"));
			}
			try {
				position.lastState = (await loadState()) ?? null;
				position.savedState = position.lastState;
				position.unsavedState = null;
			} catch (err) {
				log.error(`Traffic statistics: could not load the reader position: ${err.message}`);
			}
			if (!started) return;
			settings.enabled = enabledBySwitch ?? Boolean(values?.traffic_enabled);
			if (settings.enabled) {
				await hostList.refresh();
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

		/** Clears the timers and writes what is still counted (nothing while paused: the next start reads it again). */
		stop: async () => {
			started = false;
			stopReading();
			for (const t of [flushTimer, maintainTimer]) if (t) timers.clearInterval(t);
			flushTimer = null;
			maintainTimer = null;
			await queue(async () => {
				if (!settings.paused) await aggregator.flushNow();
			});
		},

		/**
		 * A database move: writes the counts and the reader position, then flushes and roll-ups skip until resume().
		 * The log is still read and counted in memory. One owner: a second pause() resolves at once.
		 * Rejects with "writer-running" when the writes take longer than `timeoutMs` or the position cannot be saved
		 * (the service is not paused then).
		 */
		pause: async ({ timeoutMs } = {}) => {
			if (settings.paused) return;
			const done = queue(aggregator.flushForPause);
			// a flush or roll-up queued after this one skips; this one still writes
			settings.paused = true;
			try {
				await waitWithin(done, { name: "Traffic statistics", timeoutMs, clock: timers });
			} catch (error) {
				settings.paused = false;
				throw error;
			}
		},

		/** Ends a pause: the next flush writes what was counted meanwhile, nothing runs at once. */
		resume: () => {
			settings.paused = false;
		},

		/** Starts or stops reading the access log (the switch itself is done by applyAccessLog). */
		setEnabled: async (next) => {
			settings.enabled = Boolean(next);
			enabledBySwitch = settings.enabled;
			if (!started) return;
			if (settings.enabled) {
				reader.clearRetry();
				await queue(async () => {
					await aggregator.moveToLogEnd();
					await hostList.refresh();
				});
				startReading();
			} else {
				stopReading();
				reader.clearError();
				recent.clear();
				await queue(aggregator.flushNow);
				// lines of a read that was still running when the switch went off
				recent.clear();
			}
		},

		/** Stops recording IPs at once, drops the counted ones and deletes again after a flush that was running. */
		showIpsOff: async () => {
			settings.showIps = false;
			settings.ipsOffUntil = now() + IPS_OFF_PIN_MS;
			counter.forgetIps();
			recent.forgetIps();
			aggregator.dropPendingIps();
			await queue(() => store.deleteIps());
		},

		/** Records IPs again at once: the user switched them back on and the setting is saved. */
		showIpsOn: () => {
			settings.ipsOffUntil = 0;
			settings.showIps = true;
		},

		/** Stops counting visitors at once, drops the undrained hashes and deletes the stored ones after a running flush. */
		uniqueVisitorsOff: async () => {
			settings.uniqueVisitors = false;
			settings.visitorsOffUntil = now() + VISITORS_OFF_PIN_MS;
			counter.forgetVisitors();
			aggregator.dropPendingVisitors();
			await queue(() => store.deleteVisitors());
		},

		/**
		 * Deletes every stored statistic (setEnabled(false) ran first), then drops the counts in memory. A failed
		 * delete rejects and keeps the memory as it was. The visitor key is kept.
		 */
		deleteStats: () =>
			queue(async () => {
				// lines of a read that was still running when the switch went off
				if (reader.inFlight()) await reader.inFlight();
				// a failed delete keeps the unsaved counts (the setting stays on)
				await store.deleteAll();
				counter.reset();
				aggregator.reset();
				recent.clear();
				reader.resetSkipped();
			}),

		/** Counts visitors again from the next line: the user switched them on and the setting is saved. */
		uniqueVisitorsOn: () => {
			settings.visitorsOffUntil = 0;
			settings.uniqueVisitors = true;
		},

		/** The resolver of the last host list, reloaded when older than a minute; before the first load all keys are deleted. */
		hostResolver: async () => {
			// a reload in flight is awaited (also the first one, so a concurrent call does not get an empty resolver)
			if (hostList.inFlight()) await hostList.inFlight();
			else if (hostList.hostsAt() === null || now() - hostList.hostsAt() >= HOSTS_MAX_AGE_MS)
				await hostList.refresh();
			return hostList.resolver() ?? createHostResolver([]);
		},

		/** The newest requests (in memory, NPMpro's own are not recorded), newest first; `keys` are stored host keys. */
		recent: ({ keys = null, limit = 100 } = {}) => recent.list({ keys, limit }),

		status: () => {
			const read = reader.status();
			const written = aggregator.status();
			return {
				enabled: settings.enabled,
				skipped_lines: read.skipped,
				dropped_requests: written.droppedRequests,
				last_read: read.lastRead === null ? null : new Date(read.lastRead).toISOString(),
				error: read.error ?? written.error ?? null,
				visitors_error: visitorKeyFailed && settings.uniqueVisitors ? VISITORS_KEY_ERROR : null,
			};
		},

		// exposed for tests
		read: reader.read,
		flush,
		maintain,
	};
};

/**
 * Settings hooks for the traffic switches: the access log include plus the reader. `applyAccessLog(enabled,
 * after)` writes the include, tests and reloads nginx, then runs after() and switches back when it throws.
 */
const createTrafficHooks = ({ applyAccessLog, traffic, clearCaches = () => {} }) => ({
	onTrafficEnabledChange: (enabled) => applyAccessLog(enabled, () => traffic.setEnabled(enabled)),
	onDeleteStats: async () => {
		await traffic.deleteStats();
		clearCaches();
	},
	onShowIpsOff: () => traffic.showIpsOff(),
	onShowIpsOn: () => traffic.showIpsOn(),
	// the visitor hashes are deleted: drop cached results so switching on again within the cache time shows no old counts
	onUniqueVisitorsOff: async () => {
		await traffic.uniqueVisitorsOff();
		clearCaches();
	},
	onUniqueVisitorsOn: () => traffic.uniqueVisitorsOn(),
});

export { createHostMapper, createStateMeta, createTrafficHooks, createTrafficService };
