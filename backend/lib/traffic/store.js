import db from "../../db.js";
import { cutoffs, errorRate, fillSeries, minutesToHours } from "./rollup.js";

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 24 * HOUR;

// unit "minute" reads traffic_minute, unit "hour" reads traffic_hour plus the minute rows not rolled up yet
const RANGES = {
	"1h": { unit: "minute", count: 60 },
	"24h": { unit: "minute", count: 24 * 60 },
	"7d": { unit: "hour", count: 7 * 24 },
	"30d": { unit: "hour", count: 30 * 24 },
};

const TOP = 10;
const TOP_IPS = 20;

const num = (v) => Number(v);

const TABLES = {
	minutes: ["traffic_minute", ["bucket", "host", "status_class"], ["requests", "bytes"]],
	hours: ["traffic_hour", ["bucket", "host", "status_class"], ["requests", "bytes"]],
	countries: ["traffic_country_hour", ["bucket", "host", "country"], ["requests"]],
	asns: ["traffic_asn_hour", ["bucket", "host", "asn"], ["requests"]],
	ips: ["traffic_ip_hour", ["bucket", "host", "ip"], ["requests"]],
};

const CHUNK_BUCKETS = 500;
const CHUNK_INSERT = 200;

const chunks = (list, size) => {
	const out = [];
	for (let i = 0; i < list.length; i += size) {
		out.push(list.slice(i, i + size));
	}
	return out;
};

/**
 * Adds the counters to the stored rows with the same unique key and inserts the rest.
 * One select per bucket chunk, chunked inserts for new rows, one update per existing row
 * (`col = col + ?`). Portable across SQLite, MySQL and Postgres; the caller runs it in a transaction.
 */
const addRows = async (trx, kind, rows = []) => {
	const [table, keys, adds] = TABLES[kind];
	const keyOf = (row) => keys.map((c) => String(row[c])).join("|");

	// merge duplicate keys inside the batch first
	const merged = new Map();
	for (const row of rows) {
		const hit = merged.get(keyOf(row));
		if (hit) {
			for (const c of adds) {
				hit[c] += row[c];
			}
		} else {
			merged.set(keyOf(row), { ...row });
		}
	}
	if (merged.size === 0) {
		return;
	}

	const existing = new Map();
	const buckets = [...new Set([...merged.values()].map((r) => r.bucket))];
	for (const part of chunks(buckets, CHUNK_BUCKETS)) {
		for (const found of await trx(table)
			.whereIn("bucket", part)
			.select("id", ...keys)) {
			existing.set(keyOf(found), found.id);
		}
	}

	const fresh = [];
	for (const [key, row] of merged) {
		const id = existing.get(key);
		if (id === undefined) {
			fresh.push(row);
			continue;
		}
		const patch = {};
		for (const c of adds) {
			patch[c] = trx.raw("?? + ?", [c, row[c]]);
		}
		await trx(table).where({ id }).update(patch);
	}
	for (const part of chunks(fresh, CHUNK_INSERT)) {
		await trx(table).insert(part);
	}
};

const top = (rows, limit) => rows.slice(0, limit);

/**
 * Single-writer assumption: flush and rollUpAndPrune must run through one queue (never concurrently),
 * because the select-then-write upserts would race on the unique indexes. The traffic service serialises them.
 *
 * @param   {Object}  knex  knex instance
 * @returns {Object}  store functions
 */
export const createStore = (knex) => {
	const hostFilter = (query, host) => (host ? query.where("host", host) : query);

	/** Adds the drained counters to the stored rows in one transaction. */
	const flush = ({ minutes, countries, asns, ips }) =>
		knex.transaction(async (trx) => {
			await addRows(trx, "minutes", minutes);
			await addRows(trx, "countries", countries);
			await addRows(trx, "asns", asns);
			await addRows(trx, "ips", ips);
		});

	/** Rolls minute rows older than 24 hours into traffic_hour, then deletes hour rows past the retention. */
	const rollUpAndPrune = async ({ now, retentionDays }) => {
		const { minuteBefore, hourBefore } = cutoffs({ now, retentionDays });
		await knex.transaction(async (trx) => {
			const old = await trx("traffic_minute").where("bucket", "<", minuteBefore);
			await addRows(trx, "hours", minutesToHours(old));
			await trx("traffic_minute").where("bucket", "<", minuteBefore).del();
			for (const table of ["traffic_hour", "traffic_country_hour", "traffic_asn_hour", "traffic_ip_hour"]) {
				await trx(table).where("bucket", "<", hourBefore).del();
			}
		});
	};

	const deleteIps = () => knex("traffic_ip_hour").del();

	/** Hourly rows (stored plus not yet rolled minutes) from startHour on. */
	const hourRows = async (startHour, host) => {
		const stored = await hostFilter(knex("traffic_hour").where("bucket", ">=", startHour), host);
		const minutes = await hostFilter(knex("traffic_minute").where("bucket", ">=", startHour * 60), host);
		return [...stored, ...minutesToHours(minutes)];
	};

	const sumBy = (rows, keyOf, make) => {
		const out = new Map();
		for (const row of rows) {
			const key = keyOf(row);
			const hit = out.get(key) || make(row);
			hit.requests += num(row.requests);
			if ("bytes" in hit) {
				hit.bytes += num(row.bytes);
			}
			out.set(key, hit);
		}
		return [...out.values()].sort((a, b) => b.requests - a.requests);
	};

	// Top lists read whole hour rows from the range's first hour on, so for 1h and 24h they can include up to
	// one extra partial hour compared with the totals, which count exact minutes.
	const hourTop = async (table, startHour, host, columns) => {
		const query = knex(table)
			.where("bucket", ">=", startHour)
			.groupBy(columns)
			.select(columns)
			.sum({ requests: "requests" });
		return (await hostFilter(query, host)).map((r) => ({ ...r, requests: num(r.requests) }));
	};

	const queryTraffic = async ({ range, host = "", showIps = false, now = Date.now() }) => {
		const spec = RANGES[range];
		if (!spec) {
			throw new Error(`Unknown range ${range}`);
		}
		const size = spec.unit === "minute" ? MINUTE : HOUR;
		const current = Math.floor(now / size);
		const start = current - spec.count + 1;
		const startHour = Math.floor((start * size) / HOUR);

		let rows;
		if (spec.unit === "minute") {
			rows = await hostFilter(knex("traffic_minute").where("bucket", ">=", start), host);
		} else {
			rows = await hourRows(start, host);
		}
		rows = rows.filter((r) => r.bucket >= start);

		const totals = {
			requests: rows.reduce((n, r) => n + num(r.requests), 0),
			bytes: rows.reduce((n, r) => n + num(r.bytes), 0),
			error_rate: errorRate(rows),
		};

		const countryRows = await hourTop("traffic_country_hour", startHour, host, ["country"]);
		const asnRows = await hourTop("traffic_asn_hour", startHour, host, ["asn"]);
		// asn_name: an upsert keeps the first name seen for a row; across hours max() picks one name per asn
		const asnNames = await hostFilter(
			knex("traffic_asn_hour")
				.where("bucket", ">=", startHour)
				.groupBy("asn")
				.select("asn")
				.max({ asn_name: "asn_name" }),
			host,
		);
		const names = new Map(asnNames.map((r) => [num(r.asn), r.asn_name]));
		const byCountry = sumBy(
			countryRows,
			(r) => r.country,
			(r) => ({ country: r.country, requests: 0 }),
		);
		const byAsn = sumBy(
			asnRows,
			(r) => num(r.asn),
			(r) => ({ asn: num(r.asn), asn_name: names.get(num(r.asn)) || "", requests: 0 }),
		);
		const ipRows = showIps ? await hourTop("traffic_ip_hour", startHour, host, ["ip"]) : [];

		return {
			totals,
			series: fillSeries(rows, start, spec.count),
			top_hosts: top(
				sumBy(
					rows,
					(r) => r.host,
					(r) => ({ host: r.host, requests: 0, bytes: 0 }),
				),
				TOP,
			),
			top_countries: top(byCountry, TOP),
			top_asns: top(byAsn, TOP),
			top_ips: showIps
				? top(
						sumBy(
							ipRows,
							(r) => r.ip,
							(r) => ({ ip: r.ip, requests: 0 }),
						),
						TOP_IPS,
					)
				: [],
			countries: Object.fromEntries(byCountry.map((r) => [r.country, r.requests])),
		};
	};

	/**
	 * Numbers for the dashboard. "Today" is the UTC day so far (since 00:00 UTC).
	 *
	 * @returns {Promise<{requests_today: Number, series_24h: Array, error_rate_today: Number, top_country_today: String|null}>}
	 */
	const summary = async ({ now = Date.now() } = {}) => {
		const currentHour = Math.floor(now / HOUR);
		const startHour = currentHour - 23;
		const todayHour = Math.floor(now / DAY) * 24;
		const rows = (await hourRows(startHour, "")).filter((r) => r.bucket >= startHour);
		const today = rows.filter((r) => r.bucket >= todayHour);
		const countries = await hourTop("traffic_country_hour", todayHour, "", ["country"]);
		const best = sumBy(
			countries,
			(r) => r.country,
			(r) => ({ country: r.country, requests: 0 }),
		).find((r) => r.country !== "--");
		return {
			requests_today: today.reduce((n, r) => n + num(r.requests), 0),
			series_24h: fillSeries(rows, startHour, 24).map((p) => ({
				bucket: p.bucket,
				requests: Object.values(p.by_class).reduce((a, b) => a + b, 0),
			})),
			error_rate_today: errorRate(today),
			top_country_today: best ? best.country : null,
		};
	};

	return { flush, rollUpAndPrune, deleteIps, queryTraffic, summary };
};

// Bound to the application database on first use, so importing this file does not open it.
let instance = null;
const lazy =
	(name) =>
	(...args) => {
		instance ??= createStore(db());
		return instance[name](...args);
	};

export const flush = lazy("flush");
export const rollUpAndPrune = lazy("rollUpAndPrune");
export const deleteIps = lazy("deleteIps");
export const queryTraffic = lazy("queryTraffic");
export const summary = lazy("summary");
