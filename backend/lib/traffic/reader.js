import { setImmediate as yieldToLoop } from "node:timers/promises";
import { rooted } from "../paths.js";
import { isOwnRequest, parseAlogLine } from "./parse.js";

const ACCESS_LOG = rooted("/data/nginx/logs/access.log");
const MISSING_RETRY_MS = 60000;
// lines between event loop yields, so a catch-up after downtime does not block the backend
const YIELD_EVERY = 5000;

/**
 * Reads the access log and counts its lines. `settings` and `position` are the service's shared objects (read here,
 * written by the service and the aggregator); everything else stays private and is exposed through the methods.
 *
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.createReader    (state) => { read() }
 * @param   {Object}    deps.counter
 * @param   {Object}    deps.recent
 * @param   {Object}    deps.geo
 * @param   {Object}    deps.hostList        createHostList() instance
 * @param   {Object}    deps.settings        enabled, showIps, uniqueVisitors, hashVisitor
 * @param   {Object}    deps.position        lastState
 * @param   {string}    deps.adminPort
 * @param   {string[]}  deps.bindAddresses
 * @param   {Function}  deps.now
 * @param   {Function}  deps.logOnce
 * @returns {{read: Function, resetReader: Function, inFlight: Function, status: Function, clearRetry: Function,
 *            clearError: Function, resetSkipped: Function}}
 */
const createTrafficReader = ({
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
}) => {
	let reader = null;
	let readInFlight = null;
	let retryAt = 0;
	let readError = null;
	let lastRead = null;
	let skipped = 0;

	const addLine = (line) => {
		if (line === "" || isOwnRequest(line, adminPort, bindAddresses)) return;
		const parsed = parseAlogLine(line);
		if (!parsed) {
			skipped++;
			return;
		}
		const { ip, method, path, ...rest } = parsed;
		const entry = { ...rest, host: hostList.map(parsed.host) };
		if (settings.showIps) entry.ip = ip;
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
			...(settings.showIps ? { ip } : {}),
		});
		// parseAlogLine() only returns lines with a valid client IP
		const visitorHash = settings.uniqueVisitors && settings.hashVisitor ? settings.hashVisitor(ip) : undefined;
		counter.add(entry, found, { showIps: settings.showIps, visitorHash });
	};

	const readOnce = async () => {
		try {
			reader ??= createReader(position.lastState);
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
			if (result.lines.length > 0) await hostList.loadedSince(lastRead);
			for (let i = 0; i < result.lines.length; i++) {
				if (i > 0 && i % YIELD_EVERY === 0) await yieldToLoop();
				addLine(result.lines[i]);
			}
			position.lastState = result.state;
		} catch (err) {
			readError = `Could not read the access log: ${err.message}`;
			retryAt = now() + MISSING_RETRY_MS;
			logOnce(readError);
		}
	};

	return {
		/** One read of the access log (every 5 s while enabled); a read still running is shared. */
		read: () => {
			if (readInFlight || !settings.enabled || now() < retryAt) return readInFlight ?? Promise.resolve();
			readInFlight = readOnce().finally(() => {
				readInFlight = null;
			});
			return readInFlight;
		},
		/** Drops the log reader: the next read opens it from `position.lastState`. */
		resetReader: () => {
			reader = null;
		},
		inFlight: () => readInFlight,
		status: () => ({ error: readError, lastRead, skipped }),
		clearRetry: () => {
			retryAt = 0;
		},
		clearError: () => {
			readError = null;
		},
		resetSkipped: () => {
			skipped = 0;
		},
	};
};

export { ACCESS_LOG, createTrafficReader };
