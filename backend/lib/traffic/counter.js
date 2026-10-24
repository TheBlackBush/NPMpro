import { statusClass } from "./parse.js";

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

export const createCounter = ({ maxPerKey = 1000, maxVisitors = 100000 }) => {
	let minutes = new Map();
	let countries = new Map();
	let asns = new Map();
	let ips = new Map();
	const seenAsns = new Map();
	const seenIps = new Map();
	// visitor hashes per `${day}|${host}`, (day, host) pairs that hit maxVisitors, and the rows not drained yet
	const seenVisitors = new Map();
	const cappedVisitors = new Set();
	let visitors = [];
	let skipped = 0;
	let newestHour = 0;
	let newestDay = 0;

	/** Queues a hash once per (day, host); past maxVisitors only one cap marker (empty hash) is queued. */
	const addVisitor = (day, host, hash) => {
		newestDay = Math.max(newestDay, day);
		const key = `${day}|${host}`;
		let set = seenVisitors.get(key);
		if (!set) {
			set = new Set();
			seenVisitors.set(key, set);
		}
		if (set.has(hash)) return;
		if (set.size >= maxVisitors) {
			if (!cappedVisitors.has(key)) {
				cappedVisitors.add(key);
				visitors.push({ day, host, hash: "" });
			}
			return;
		}
		set.add(hash);
		visitors.push({ day, host, hash });
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
		add(entry, geo, { showIps, visitorHash }) {
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
			seenVisitors.clear();
			cappedVisitors.clear();
		},

		drain() {
			const out = {
				minutes: [...minutes.values()],
				countries: [...countries.values()],
				asns: [...asns.values()],
				ips: [...ips.values()],
				visitors,
				skipped,
			};
			minutes = new Map();
			countries = new Map();
			asns = new Map();
			ips = new Map();
			visitors = [];
			// Keep the previous hour too: lines can arrive slightly late around the hour boundary.
			for (const seen of [seenAsns, seenIps]) {
				for (const key of seen.keys()) {
					if (Number(key.slice(0, key.indexOf("|"))) < newestHour - 1) {
						seen.delete(key);
					}
				}
			}
			// Keep yesterday too, for lines that arrive late around midnight (UTC).
			for (const key of seenVisitors.keys()) {
				if (Number(key.slice(0, key.indexOf("|"))) < newestDay - 1) {
					seenVisitors.delete(key);
					cappedVisitors.delete(key);
				}
			}
			skipped = 0;
			return out;
		},
	};
};
