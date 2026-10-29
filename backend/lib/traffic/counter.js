import { statusClass } from "./parse.js";
import { pathHash } from "./path-hash.js";

// the row that counts the missing paths over the per host and day cap
export const OTHER_PATH = "(other)";

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;

const bump = (map, key, make, requests = 1) => {
	const row = map.get(key);
	if (row) {
		row.requests += requests;
		return row;
	}
	const created = make();
	created.requests = requests;
	map.set(key, created);
	return created;
};

/** Set members are the 16 hash bytes as a latin1 string (16 one byte chars) instead of 32 hex chars. */
const packHash = (hex) => Buffer.from(hex, "hex").toString("latin1");

/**
 * In-memory counts between two flushes, plus the admission sets that bound the stored keys.
 *
 * Visitor memory: each (day, host) set keeps one packed hash per visitor, about 60 to 70 bytes with the Set
 * overhead. Today and yesterday are kept, so at the highest cap (1,000,000) one busy host can take up to
 * about 130 MB; at the default cap (100,000) about 13 MB per host.
 *
 * @param   {Object}  options
 * @param   {number}  [options.maxPerKey]    distinct ASNs and IPs per host and hour
 * @param   {number}  [options.maxVisitors]  distinct visitors per host and day (changed by setVisitorsCap)
 * @param   {number}  [options.maxPaths]     distinct missing page paths per host and UTC day
 * @param   {number}  [options.maxPathsTotal]  distinct missing page paths per UTC day over all hosts
 */
export const createCounter = ({ maxPerKey = 1000, maxVisitors = 100000, maxPaths = 500, maxPathsTotal = 50000 }) => {
	let minutes = new Map();
	let countries = new Map();
	let asns = new Map();
	let ips = new Map();
	const seenAsns = new Map();
	const seenIps = new Map();
	// per `${day}|${host}`: seen = packed hashes queued in this run or stored before the start (seedVisitors),
	// marked = a cap marker is stored or queued
	const dayVisitors = new Map();
	let visitors = [];
	let visitorsCap = maxVisitors;
	let skipped = 0;
	let newestHour = 0;
	let newestDay = 0;
	let paths = new Map();
	// per `${day}|${host}`: the hashes (pathHash, a number each) of the distinct missing page paths queued in this run or
	// stored before the start (seedPaths); a number instead of the string keeps 1,000 names at the cap in a few MB
	const dayPaths = new Map();
	// per UTC day: distinct paths over all hosts (the safety cap maxPathsTotal)
	const dayPathTotals = new Map();
	let newestPathDay = 0;

	const visitorEntry = (day, host) => {
		newestDay = Math.max(newestDay, day);
		const key = `${day}|${host}`;
		let entry = dayVisitors.get(key);
		if (!entry) {
			entry = { seen: new Set(), marked: false };
			dayVisitors.set(key, entry);
		}
		return entry;
	};

	/** Queues a hash once per (day, host); at the cap only one marker (empty hash) is queued. */
	const addVisitor = (day, host, hash) => {
		const entry = visitorEntry(day, host);
		const packed = packHash(hash);
		if (entry.seen.has(packed)) return;
		if (entry.seen.size >= visitorsCap) {
			if (!entry.marked) {
				entry.marked = true;
				visitors.push({ day, host, hash: "" });
			}
			return;
		}
		entry.seen.add(packed);
		visitors.push({ day, host, hash });
	};

	const pathSet = (day, host) => {
		newestPathDay = Math.max(newestPathDay, day);
		const key = `${day}|${host}`;
		let set = dayPaths.get(key);
		if (!set) {
			set = new Set();
			dayPaths.set(key, set);
		}
		return set;
	};

	/** Adds a path hash to (day, host) and the day total; false when a cap is reached and it was not there yet. */
	const admitPath = (day, host, hash) => {
		const set = pathSet(day, host);
		if (set.has(hash)) return true;
		const total = dayPathTotals.get(day) ?? 0;
		if (set.size >= maxPaths || total >= maxPathsTotal) return false;
		set.add(hash);
		dayPathTotals.set(day, total + 1);
		return true;
	};

	/** Counts a missing page under its path, or under (other) once a cap of its UTC day is reached. */
	const addPath = (entry, path) => {
		const stored = admitPath(Math.floor(entry.time / DAY), entry.host, pathHash(path)) ? path : OTHER_PATH;
		const hour = Math.floor(entry.time / HOUR);
		const lastSeen = Math.floor(entry.time / 1000);
		const row = bump(paths, `${hour}|${entry.host}|${stored}`, () => ({
			bucket: hour,
			host: entry.host,
			path: stored,
			last_seen: lastSeen,
		}));
		row.last_seen = Math.max(row.last_seen, lastSeen);
	};

	// Adds a value for (hour, host) unless that pair already holds maxPerKey distinct values.
	// The sets outlive drain() so the cap holds for the whole hour; drain() prunes old hours.
	const admit = (seen, hour, host, value) => {
		newestHour = Math.max(newestHour, hour);
		const key = `${hour}|${host}`;
		let set = seen.get(key);
		if (!set) {
			set = new Set();
			seen.set(key, set);
		}
		if (set.has(value)) {
			return true;
		}
		if (set.size >= maxPerKey) {
			return false;
		}
		set.add(value);
		return true;
	};

	return {
		add(entry, geo, { showIps, visitorHash, missingPath }) {
			const minute = Math.floor(entry.time / MINUTE);
			const hour = Math.floor(entry.time / HOUR);
			const { host } = entry;
			const sc = statusClass(entry.status);
			const row = bump(minutes, `${minute}|${host}|${sc}`, () => ({
				bucket: minute,
				host,
				status_class: sc,
				bytes: 0,
			}));
			row.bytes += entry.bytes;

			if (geo) {
				const country = geo.country || "--";
				bump(countries, `${hour}|${host}|${country}`, () => ({ bucket: hour, host, country }));
				if (geo.asn) {
					const keep = admit(seenAsns, hour, host, geo.asn);
					const asn = keep ? geo.asn : 0;
					const asnName = keep ? geo.asnName || "" : "Other";
					bump(asns, `${hour}|${host}|${asn}`, () => ({ bucket: hour, host, asn, asn_name: asnName }));
				}
			}

			if (showIps) {
				const ip = admit(seenIps, hour, host, entry.ip) ? entry.ip : "other";
				bump(ips, `${hour}|${host}|${ip}`, () => ({ bucket: hour, host, ip }));
			}

			if (visitorHash) {
				addVisitor(Math.floor(entry.time / DAY), host, visitorHash);
			}

			if (missingPath !== undefined) addPath(entry, missingPath);
		},

		skip() {
			skipped++;
		},

		/** Drops the undrained IP rows and the per hour IP admission sets ("show visitor IPs" was switched off). */
		forgetIps() {
			ips = new Map();
			seenIps.clear();
		},

		/** Drops the undrained visitor rows and the per day visitor sets ("count unique visitors" was switched off). */
		forgetVisitors() {
			visitors = [];
			dayVisitors.clear();
		},

		/** Drops the undrained path rows and the per day path sets ("track missing pages" was switched off). */
		forgetPaths() {
			paths = new Map();
			dayPaths.clear();
			dayPathTotals.clear();
		},

		/** Drops everything counted and every admission set: the stored statistics were deleted. */
		reset() {
			minutes = new Map();
			countries = new Map();
			asns = new Map();
			ips = new Map();
			visitors = [];
			seenAsns.clear();
			seenIps.clear();
			dayVisitors.clear();
			paths = new Map();
			dayPaths.clear();
			dayPathTotals.clear();
			skipped = 0;
		},

		/**
		 * Starts from the stored paths after a restart, so the caps hold for the whole day (a seeded hash counts once,
		 * like a path counted in this run).
		 *
		 * @param {Array<{day: number, host: string, hashes: number[]}>} rows  without (other)
		 */
		seedPaths(rows) {
			for (const row of rows) {
				const set = pathSet(row.day, row.host);
				for (const hash of row.hashes) {
					if (set.has(hash)) continue;
					set.add(hash);
					dayPathTotals.set(row.day, (dayPathTotals.get(row.day) ?? 0) + 1);
				}
			}
		},

		/**
		 * Starts from the stored hashes after a restart, so the cap holds for the whole day and a returning visitor
		 * is not counted against it twice (the sets hold the same hashes as without a restart). A pair is full only
		 * when its stored visitors reach the current cap (a marker from a lower cap does not block a raised one);
		 * a stored marker is never queued again.
		 *
		 * @param {Array<{day: number, host: string, hashes: string[], capped: boolean}>} rows  hex hashes, no marker
		 */
		seedVisitors(rows) {
			for (const { day, host, hashes, capped } of rows) {
				const entry = visitorEntry(day, host);
				for (const hash of hashes) entry.seen.add(packHash(hash));
				entry.marked = entry.marked || capped;
			}
		},

		/** Applies a changed visitors_cap from the next line on. */
		setVisitorsCap(cap) {
			visitorsCap = cap;
		},

		/**
		 * Forgets drained visitor rows that were dropped unsaved (the 10-minute rule), so those visitors and the cap
		 * marker can be queued again the same day.
		 *
		 * @param {Array<{day: number, host: string, hash: string}>} rows
		 */
		dropVisitors(rows) {
			for (const { day, host, hash } of rows) {
				const entry = dayVisitors.get(`${day}|${host}`);
				if (!entry) continue;
				if (hash === "") entry.marked = false;
				else entry.seen.delete(packHash(hash));
			}
		},

		drain() {
			const out = {
				minutes: [...minutes.values()],
				countries: [...countries.values()],
				asns: [...asns.values()],
				ips: [...ips.values()],
				visitors,
				paths: [...paths.values()],
				skipped,
			};
			minutes = new Map();
			countries = new Map();
			asns = new Map();
			ips = new Map();
			visitors = [];
			paths = new Map();
			// Keep the previous hour too: lines can arrive slightly late around the hour boundary.
			for (const seen of [seenAsns, seenIps]) {
				for (const key of seen.keys()) {
					if (Number(key.slice(0, key.indexOf("|"))) < newestHour - 1) {
						seen.delete(key);
					}
				}
			}
			// Keep yesterday too, for lines that arrive late around midnight (UTC).
			for (const key of dayVisitors.keys()) {
				if (Number(key.slice(0, key.indexOf("|"))) < newestDay - 1) {
					dayVisitors.delete(key);
				}
			}
			for (const key of dayPaths.keys()) {
				if (Number(key.slice(0, key.indexOf("|"))) < newestPathDay - 1) dayPaths.delete(key);
			}
			for (const day of dayPathTotals.keys()) {
				if (day < newestPathDay - 1) dayPathTotals.delete(day);
			}
			skipped = 0;
			return out;
		},
	};
};
