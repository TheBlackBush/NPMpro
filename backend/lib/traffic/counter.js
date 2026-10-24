import { statusClass } from "./parse.js";

const MINUTE = 60000;
const HOUR = 3600000;

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

export const createCounter = ({ maxPerKey = 1000 }) => {
	let minutes = new Map();
	let countries = new Map();
	let asns = new Map();
	let ips = new Map();
	let seenAsns = new Map();
	let seenIps = new Map();
	let skipped = 0;

	// Adds a value for (hour, host) unless that pair already holds maxPerKey distinct values.
	const admit = (seen, hour, host, value) => {
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
		add(entry, geo, { showIps }) {
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
		},

		skip() {
			skipped++;
		},

		drain() {
			const out = {
				minutes: [...minutes.values()],
				countries: [...countries.values()],
				asns: [...asns.values()],
				ips: [...ips.values()],
				skipped,
			};
			minutes = new Map();
			countries = new Map();
			asns = new Map();
			ips = new Map();
			seenAsns = new Map();
			seenIps = new Map();
			skipped = 0;
			return out;
		},
	};
};
