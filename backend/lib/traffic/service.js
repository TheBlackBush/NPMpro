import { stat } from "node:fs/promises";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { global as logger } from "../../logger.js";
import { waitWithin, writerRunning } from "../database/pause.js";
import { createCounter } from "./counter.js";
import { createHostResolver } from "./host-resolver.js";
import { createLogReader } from "./log-reader.js";
import { isOwnRequest, parseAlogLine } from "./parse.js";
import { createRecent } from "./recent.js";
import { createVisitorHasher } from "./visitor-hash.js";

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
// the same for "count unique visitors"
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
 * Maps a request host to the host key that is stored: a managed domain name, the managed wildcard name it
 * matches (`*.example.com`, `.example.com`) or `_other` for everything else (default site, IPs, random names).
 * Storing the wildcard name instead of the real sub domain keeps the tables bounded.
 * Trailing wildcards (`www.example.*`) and regex names are not matched: their requests fall back to `_other`.
 * Every configured host counts as managed, also a disabled one (its requests reach the default site anyway).
 *
 * @param   {Iterable<string>}  domains  domain names of the managed hosts
 * @returns {((host: string) => string) & {keys: Set<string>}}  `keys` holds every key it can return
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
	const map = (host) => {
		if (host && exact.has(host)) return host;
		if (host) {
			for (const w of wildcards) {
				if (host === w.self || (host.endsWith(w.suffix) && host.length > w.suffix.length)) return w.name;
			}
		}
		return OTHER_HOST;
	};
	// every key the mapper can return
	map.keys = new Set([...exact, ...wildcards.map((w) => w.name), OTHER_HOST]);
	return map;
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
	data.minutes.length > 0 ||
	data.countries.length > 0 ||
	data.asns.length > 0 ||
	data.ips.length > 0 ||
	data.visitors.length > 0;

const mergeBatches = (batches) => ({
	minutes: batches.flatMap((b) => b.minutes),
	countries: batches.flatMap((b) => b.countries),
	asns: batches.flatMap((b) => b.asns),
	ips: batches.flatMap((b) => b.ips),
	visitors: batches.flatMap((b) => b.visitors),
});

/**
 * Reader position and visitor key share the meta of the `traffic-state` settings row. Each write reads the
 * current meta first and only replaces its own fields, so neither overwrites the other.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.read   () => Promise<Object|undefined>  the stored meta
 * @param   {Function}  deps.write  (meta) => Promise  stores the whole meta (insert or update)
 * @returns {{loadState: Function, saveState: Function, readMeta: Function, writeMeta: Function}}
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
 * The traffic statistics pipeline: access log reader, parser, GeoIP, counter and store on timers.
 * Reads every 5 s while enabled, flushes every 60 s (and saves the reader position after a successful flush),
 * rolls up and prunes hourly. Failures never throw out of the timers: they are logged and exposed by status().
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.store        { flush, rollUpAndPrune, deleteIps, deleteVisitors, deleteAll,
 *                                        visitorDayHashes }
 *                                        (lib/traffic/store.js)
 * @param   {Object}    deps.geo          { lookup(ip), available() } (lib/geoip/lookup.js)
 * @param   {Function}  deps.getConfig    () => Promise<{ values: { traffic_enabled, retention_days, show_ips,
 *                                        unique_visitors, visitors_cap } }>
 * @param   {Function}  deps.loadState    () => Promise<{ inode, offset } | null>
 * @param   {Function}  deps.saveState    (state) => Promise
 * @param   {Function}  deps.loadHosts    () => Promise<Array<{id, type, domain_names}>>  the managed hosts
 *                                        (proxy, redirection and dead hosts)
 * @param   {Function}  [deps.loadVisitorKey]  () => Promise<{ key: Buffer, created: boolean, replaced: boolean }>,
 *                                             called once in start();
 *                                             without it (or when it fails) unique visitors are not counted
 * @param   {Function}  [deps.createReader]  (state) => { read() }
 * @param   {Function}  [deps.statLog]   () => Promise<{ino, size}>  the access log (rejects with ENOENT when missing)
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.timers]     { setInterval, clearInterval, setTimeout, clearTimeout } (the timeouts only
 *                                        for a pause with a time limit)
 * @param   {number}    [deps.maxPerKey]
 * @param   {number}    [deps.maxVisitors]  distinct visitors per host and day until the settings give visitors_cap
 * @param   {string}    [deps.adminPort]  NPM_PORT: requests to the admin UI and the health check are not counted
 * @param   {string[]}  [deps.bindAddresses]  NPM_IPV4_BINDING: the health check may come from it as well as loopback
 * @returns {Object}
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
	const queue = createQueue();
	const counter = createCounter({ maxPerKey, maxVisitors });
	// the newest requests for the API, in memory only; IPs only while show_ips is on
	const recent = createRecent();
	let mapHost = createHostMapper([]);
	// null until the host list was loaded once; a failed reload keeps the previous one
	let resolver = null;
	// start time of the last successful load, null before it and after a failed one (the next read or API call
	// retries)
	let hostsAt = null;
	let hostsInFlight = null;
	let hostsError = null;

	let started = false;
	let enabled = false;
	// set by setEnabled() when the hook runs before start() finished
	let enabledBySwitch = null;
	// the settings could not be read in start(): the enabled state and the IP cleanup wait for the next refresh
	let startupPending = false;
	let showIps = false;
	let ipsOffUntil = 0;
	let uniqueVisitors = false;
	let visitorsOffUntil = 0;
	// set from the visitor key in start(); null while no key could be loaded
	let hashVisitor = null;
	let visitorKeyFailed = false;
	let retentionDays = 30;

	let reader = null;
	let readInFlight = null;
	let retryAt = 0;
	let lastState = null;
	let savedState = null;
	// the position of counts that were written while saving it failed (cleared by the next save that works)
	let unsavedState = null;
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
	// a database move: nothing is written (the log is still read and counted in memory) until resume()
	let paused = false;

	const logOnce = (message) => {
		if (message !== loggedError) log.error(`Traffic statistics: ${message}`);
		loggedError = message;
	};

	const applyConfig = (values) => {
		retentionDays = values.retention_days;
		counter.setVisitorsCap(values.visitors_cap ?? maxVisitors);
		if (!(values.unique_visitors && now() < visitorsOffUntil)) {
			if (!values.unique_visitors) visitorsOffUntil = 0;
			uniqueVisitors = Boolean(values.unique_visitors);
		}
		if (values.show_ips && now() < ipsOffUntil) return;
		if (!values.show_ips) ipsOffUntil = 0;
		if (showIps && !values.show_ips) recent.forgetIps();
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

	const loadHostsOnce = async () => {
		const at = now();
		try {
			const hosts = await loadHosts();
			mapHost = createHostMapper(hosts.flatMap((host) => host.domain_names ?? []));
			resolver = createHostResolver(hosts);
			// per host lists of keys that are no longer counted (host removed or renamed)
			recent.keepHosts(mapHost.keys);
			hostsAt = at;
			hostsError = null;
		} catch (err) {
			hostsAt = null;
			// retried on every read while it fails: logged once until a load succeeds
			if (hostsError !== err?.message) logError("could not read the host list")(err);
			hostsError = err?.message ?? String(err);
		}
	};

	/** Reloads the managed hosts; a reload still running is shared. */
	const refreshHosts = () => {
		hostsInFlight ??= loadHostsOnce().finally(() => {
			hostsInFlight = null;
		});
		return hostsInFlight;
	};

	/** Waits for a host list whose load started at or after `time` (a reload in flight is awaited first). */
	const hostsLoadedSince = async (time) => {
		if (hostsAt !== null && hostsAt >= time) return;
		if (hostsInFlight) await hostsInFlight;
		if (hostsAt === null || hostsAt < time) await refreshHosts();
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
			if (!uniqueVisitors) {
				// also the per day hashes seeded at start, they are the ones deleted here
				counter.forgetVisitors();
				await store.deleteVisitors().catch(logError("could not delete the stored visitor hashes"));
			}
		}
		// the host list is only needed while lines are counted
		if (enabled) await refreshHosts();
	};

	const addLine = (line) => {
		if (line === "" || isOwnRequest(line, adminPort, bindAddresses)) return;
		const parsed = parseAlogLine(line);
		if (!parsed) {
			skipped++;
			return;
		}
		const { ip, method, path, ...rest } = parsed;
		const entry = { ...rest, host: mapHost(parsed.host) };
		if (showIps) entry.ip = ip;
		const available = geo.available();
		const found = available.country || available.asn ? geo.lookup(ip) : null;
		recent.add({
			time: entry.time,
			host: entry.host,
			method,
			path,
			status: entry.status,
			bytes: entry.bytes,
			country: found?.country ?? null,
			...(showIps ? { ip } : {}),
		});
		// parseAlogLine() only returns lines with a valid client IP
		const visitorHash = uniqueVisitors && hashVisitor ? hashVisitor(ip) : undefined;
		counter.add(entry, found, { showIps, visitorHash });
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
			// The lines are mapped with a host list loaded after they were read: a host row is saved before nginx
			// serves the host, so the first requests to a new host get its own key instead of _other (stored for
			// good). Like this the list is reloaded at most once per read (every 5 s) while lines come in.
			if (result.lines.length > 0) await hostsLoadedSince(lastRead);
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
		if (!uniqueVisitors) data.visitors = [];
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
				// those visitors were never stored: let them be counted again today
				counter.dropVisitors(old.flatMap((p) => p.data.visitors));
				return;
			}
		}
		if (state && (savedState?.inode !== state.inode || savedState?.offset !== state.offset)) {
			try {
				await saveState(state);
				savedState = state;
				unsavedState = null;
			} catch (err) {
				unsavedState = state;
				log.error(`Traffic statistics: could not save the reader position: ${err.message}`);
			}
		}
	};

	/**
	 * The final write of a pause: the counts, then the reader position of the counts written. A position that could
	 * not be saved is tried once more; when that fails too the pause fails, because a move would copy counts whose
	 * lines the new process reads again.
	 */
	const flushForPause = async () => {
		await flushNow();
		if (!unsavedState) return;
		const state = unsavedState;
		try {
			await saveState(state);
			savedState = state;
			unsavedState = null;
		} catch (err) {
			throw writerRunning(`Traffic statistics: the access log position could not be saved (${err.message})`);
		}
	};

	/**
	 * Moves the reader to the current end of the access log and saves that position (runs inside the queue): the
	 * lines nginx wrote while statistics were off (Write log files keeps the log on) are not counted. A missing log
	 * starts from its beginning once it exists; another stat error keeps the old position.
	 */
	const moveToLogEnd = async () => {
		if (readInFlight) await readInFlight;
		let state = null;
		try {
			const st = await statLog();
			state = { inode: Number(st.ino), offset: Number(st.size) };
		} catch (err) {
			if (err?.code !== "ENOENT") {
				logError("could not find the end of the access log")(err);
				return;
			}
		}
		reader = null;
		lastState = state;
		if (!state) return;
		try {
			await saveState(state);
			savedState = state;
			// a newer saved position: an older unsaved one must never be written over it
			unsavedState = null;
		} catch (err) {
			log.error(`Traffic statistics: could not save the reader position: ${err.message}`);
		}
	};

	const flush = () =>
		queue(async () => {
			if (paused) return;
			await flushNow();
			await refresh();
		});

	const maintain = () =>
		queue(async () => {
			if (paused) return;
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
			// once per start and inside the queue: two concurrent first loads would each create a key
			const keyCreated = await queue(async () => {
				if (!loadVisitorKey) return false;
				try {
					const { key, created, replaced } = await loadVisitorKey();
					hashVisitor = createVisitorHasher(key);
					if (replaced) log.error(`Traffic statistics: ${VISITORS_KEY_REPLACED}`);
					return created;
				} catch (err) {
					visitorKeyFailed = true;
					logError("could not load the visitor key, unique visitors are not counted")(err);
					return false;
				}
			});
			// a new key cannot match the stored hashes; with the setting known to be off they are removed too
			if (keyCreated || (values !== null && !uniqueVisitors)) {
				await queue(() => store.deleteVisitors()).catch(logError("could not delete the stored visitor hashes"));
			} else if (hashVisitor) {
				// the per day cap counts the visitors stored before this start, returning ones only once
				await queue(async () => {
					const today = Math.floor(now() / DAY);
					counter.seedVisitors(await store.visitorDayHashes({ days: [today - 1, today] }));
				}).catch(logError("could not read the stored visitor hashes"));
			}
			if (values === null) {
				startupPending = true;
			} else if (!showIps) {
				// covers TRAFFIC_SHOW_IPS=false set while IPs were stored; only when the setting is known to be off
				await queue(() => store.deleteIps()).catch(logError("could not delete the stored IPs"));
			}
			try {
				lastState = (await loadState()) ?? null;
				savedState = lastState;
				unsavedState = null;
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

		/**
		 * Clears the timers and writes what is still counted. While paused it writes nothing: the lines read since the
		 * pause are read again from the saved reader position at the next start.
		 */
		stop: async () => {
			started = false;
			stopReading();
			for (const t of [flushTimer, maintainTimer]) if (t) timers.clearInterval(t);
			flushTimer = null;
			maintainTimer = null;
			await queue(async () => {
				if (!paused) await flushNow();
			});
		},

		/**
		 * A database move: writes the counts and the reader position of everything read so far (after a flush or
		 * roll-up that is going on), then the flushes and roll-ups skip until resume(). The access log is still read
		 * and counted in memory: after a failed move the next flush writes it, after a successful one the new
		 * process reads it again from the position saved here. The timers keep running.
		 *
		 * A pause has one owner (the move): a second pause() resolves at once and one resume() ends the pause.
		 *
		 * @param {{ timeoutMs?: number }} [options]  rejects with "writer-running" when the writes take longer or the
		 *                                            reader position cannot be saved, and the service is not paused then
		 */
		pause: async ({ timeoutMs } = {}) => {
			if (paused) return;
			const done = queue(flushForPause);
			// a flush or roll-up queued after this one skips; this one still writes
			paused = true;
			try {
				await waitWithin(done, { name: "Traffic statistics", timeoutMs, clock: timers });
			} catch (error) {
				paused = false;
				throw error;
			}
		},

		/** Ends a pause: the next flush writes what was counted meanwhile, nothing runs at once. */
		resume: () => {
			paused = false;
		},

		/** Starts or stops reading the access log (the switch itself is done by applyAccessLog). */
		setEnabled: async (next) => {
			enabled = Boolean(next);
			enabledBySwitch = enabled;
			if (!started) return;
			if (enabled) {
				retryAt = 0;
				await queue(async () => {
					await moveToLogEnd();
					await refreshHosts();
				});
				startReading();
			} else {
				stopReading();
				readError = null;
				recent.clear();
				await queue(flushNow);
				// lines of a read that was still running when the switch went off
				recent.clear();
			}
		},

		/** Stops recording IPs at once, drops the counted ones and deletes again after a flush that was running. */
		showIpsOff: async () => {
			showIps = false;
			ipsOffUntil = now() + IPS_OFF_PIN_MS;
			counter.forgetIps();
			recent.forgetIps();
			for (const p of pending) p.data.ips = [];
			await queue(() => store.deleteIps());
		},

		/** Records IPs again at once: the user switched them back on and the setting is saved. */
		showIpsOn: () => {
			ipsOffUntil = 0;
			showIps = true;
		},

		/** Stops counting visitors at once, drops the undrained hashes and deletes the stored ones after a running flush. */
		uniqueVisitorsOff: async () => {
			uniqueVisitors = false;
			visitorsOffUntil = now() + VISITORS_OFF_PIN_MS;
			counter.forgetVisitors();
			for (const p of pending) p.data.visitors = [];
			await queue(() => store.deleteVisitors());
		},

		/**
		 * Deletes every stored statistic (traffic statistics are being switched off, setEnabled(false) ran first).
		 * Inside the queue, after a flush or roll-up that was still running: empties the tables, then drops what is
		 * counted in memory, the pending batches and the recent requests. A failed delete rejects (the caller saves
		 * nothing) and keeps the memory as it was. The visitor key is kept. The
		 * reader position needs no reset here: switching statistics on moves it to the end of the access log, so
		 * neither these lines nor the ones written while statistics were off are counted again.
		 */
		deleteStats: () =>
			queue(async () => {
				// lines of a read that was still running when the switch went off
				if (readInFlight) await readInFlight;
				// a failed delete keeps the unsaved counts (the setting stays on)
				await store.deleteAll();
				counter.reset();
				pending = [];
				recent.clear();
				skipped = 0;
				droppedRequests = 0;
				flushError = null;
			}),

		/** Counts visitors again from the next line: the user switched them on and the setting is saved. */
		uniqueVisitorsOn: () => {
			visitorsOffUntil = 0;
			uniqueVisitors = true;
		},

		/**
		 * The host resolver of the last host list. Reloaded first when it is older than a minute (also while
		 * traffic statistics are off); before the first successful load every key resolves as a deleted host.
		 *
		 * @returns {Promise<ReturnType<typeof createHostResolver>>}
		 */
		hostResolver: async () => {
			// a reload in flight is awaited (also the first one, so a concurrent call does not get an empty resolver)
			if (hostsInFlight) await hostsInFlight;
			else if (hostsAt === null || now() - hostsAt >= HOSTS_MAX_AGE_MS) await refreshHosts();
			return resolver ?? createHostResolver([]);
		},

		/**
		 * The newest requests (in memory, NPMpro's own requests are not recorded), newest first.
		 *
		 * @param   {Object}         [options]
		 * @param   {string[]|null}  [options.keys]   stored host keys; null for all hosts
		 * @param   {number}         [options.limit]
		 * @returns {Array<{time: number, host: string, method: string, path: string, status: number, bytes: number,
		 *          country: string|null, ip?: string}>}
		 */
		recent: ({ keys = null, limit = 100 } = {}) => recent.list({ keys, limit }),

		status: () => ({
			enabled,
			skipped_lines: skipped,
			dropped_requests: droppedRequests,
			last_read: lastRead === null ? null : new Date(lastRead).toISOString(),
			error: readError ?? flushError ?? null,
			visitors_error: visitorKeyFailed && uniqueVisitors ? VISITORS_KEY_ERROR : null,
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
 * @param   {Function}  deps.applyAccessLog  (enabled, after) => Promise, writes the include, tests and reloads nginx,
 *                                           then runs after() (starts or stops the reader) and switches the include
 *                                           back when after() throws
 * @param   {Object}    deps.traffic         createTrafficService() instance
 * @param   {Function}  [deps.clearCaches]   drops the cached API results after the statistics were deleted
 * @returns {{onTrafficEnabledChange: Function, onDeleteStats: Function, onShowIpsOff: Function,
 *            onShowIpsOn: Function, onUniqueVisitorsOff: Function, onUniqueVisitorsOn: Function}}
 */
const createTrafficHooks = ({ applyAccessLog, traffic, clearCaches = () => {} }) => ({
	onTrafficEnabledChange: (enabled) => applyAccessLog(enabled, () => traffic.setEnabled(enabled)),
	onDeleteStats: async () => {
		await traffic.deleteStats();
		clearCaches();
	},
	onShowIpsOff: () => traffic.showIpsOff(),
	onShowIpsOn: () => traffic.showIpsOn(),
	onUniqueVisitorsOff: () => traffic.uniqueVisitorsOff(),
	onUniqueVisitorsOn: () => traffic.uniqueVisitorsOn(),
});

export { ACCESS_LOG, createHostMapper, createStateMeta, createTrafficHooks, createTrafficService, OTHER_HOST };
