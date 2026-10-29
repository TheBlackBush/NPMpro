import { setImmediate as yieldToLoop } from "node:timers/promises";
import db from "../../db.js";
import { OTHER_PATH } from "./counter.js";
import { pathHash } from "./path-hash.js";
import { cutoffs, errorRate, fillSeries, minutesToHours } from "./rollup.js";
import { CHUNK_INSERT, chunks, mergeRows, upsertRows } from "./upsert.js";

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 24 * HOUR;
// one week of hour buckets per DELETE
const DELETE_SPAN = 7 * 24;

// unit "minute" reads traffic_minute, unit "hour" reads traffic_hour plus the minute rows not rolled up yet
const RANGES = {
	"1h": { unit: "minute", count: 60 },
	"24h": { unit: "minute", count: 24 * 60 },
	"7d": { unit: "hour", count: 7 * 24 },
	"30d": { unit: "hour", count: 30 * 24 },
};

const TOP = 10;
const TOP_IPS = 10;

const num = (v) => Number(v);

const TABLES = {
	minutes: { table: "traffic_minute", keys: ["bucket", "host", "status_class"], adds: ["requests", "bytes"] },
	hours: { table: "traffic_hour", keys: ["bucket", "host", "status_class"], adds: ["requests", "bytes"] },
	countries: { table: "traffic_country_hour", keys: ["bucket", "host", "country"], adds: ["requests"] },
	asns: { table: "traffic_asn_hour", keys: ["bucket", "host", "asn"], adds: ["requests"] },
	ips: { table: "traffic_ip_hour", keys: ["bucket", "host", "ip"], adds: ["requests"] },
	paths: { table: "traffic_path_hour", keys: ["bucket", "host", "path"], adds: ["requests"], maxes: ["last_seen"] },
};

// every table with stored traffic data (deleteAll empties them all)
const ALL_TABLES = [
	"traffic_minute",
	"traffic_hour",
	"traffic_country_hour",
	"traffic_asn_hour",
	"traffic_ip_hour",
	"traffic_path_hour",
	"traffic_visitor",
];

const addRows = (trx, kind, rows) => upsertRows(trx, TABLES[kind], rows);

const top = (rows, limit) => rows.slice(0, limit);

/**
 * Single-writer assumption: flush and rollUpAndPrune must run through one queue (never concurrently),
 * because the select-then-write upserts would race on the unique indexes. The traffic service serialises them.
 *
 * @param   {Object}  knex  knex instance
 * @returns {Object}  store functions
 */
export const createStore = (knex) => {
	// the hour of a minute bucket (integer division; bucket is an integer column in every dialect)
	const client = knex.client?.config?.client;
	const hourOfMinute = client === "mysql2" || client === "mysql" ? "bucket DIV 60" : "bucket / 60";
	// the UTC day of an hour bucket (integer division)
	const dayOfHour = client === "mysql2" || client === "mysql" ? "bucket DIV 24" : "bucket / 24";

	// host: one key (empty = all) or a list of keys (empty list matches nothing)
	const hostFilter = (query, host) => {
		if (Array.isArray(host)) {
			return query.whereIn("host", host);
		}
		return host ? query.where("host", host) : query;
	};

	/** Adds the drained counters to the stored rows in one transaction. */
	const flush = ({ minutes, countries, asns, ips, visitors = [], paths = [] }) =>
		knex.transaction(async (trx) => {
			await addRows(trx, "minutes", minutes);
			await addRows(trx, "countries", countries);
			await addRows(trx, "asns", asns);
			await addRows(trx, "ips", ips);
			await mergeRows(trx, TABLES.paths, paths);
			// duplicates (re-sent after a restart) are ignored by the unique index
			for (const part of chunks(visitors, CHUNK_INSERT)) {
				await trx("traffic_visitor").insert(part).onConflict(["day", "host", "hash"]).ignore();
			}
		});

	/** Rolls minute rows older than 24 hours into traffic_hour, then deletes hour rows past the retention. */
	const rollUpAndPrune = async ({ now, retentionDays }) => {
		const { minuteBefore, hourBefore } = cutoffs({ now, retentionDays });
		await knex.transaction(async (trx) => {
			const old = await trx("traffic_minute").where("bucket", "<", minuteBefore);
			await addRows(trx, "hours", minutesToHours(old));
			await trx("traffic_minute").where("bucket", "<", minuteBefore).del();
			// path rows of days before yesterday (all at least 48 hours old): one row per (UTC day, host, path) at
			// bucket = day * 24 (a row of hour 0 already has that key and is merged into)
			const pathDayBefore = (Math.floor(now / DAY) - 2) * 24;
			const folded = await trx("traffic_path_hour")
				.where("bucket", "<", pathDayBefore)
				.whereRaw("bucket % 24 <> 0")
				.select(trx.raw(`${dayOfHour} as day`), "host", "path")
				.sum({ requests: "requests" })
				.max({ last_seen: "last_seen" })
				.groupByRaw(`${dayOfHour}, host, path`);
			await trx("traffic_path_hour").where("bucket", "<", pathDayBefore).whereRaw("bucket % 24 <> 0").del();
			await mergeRows(
				trx,
				TABLES.paths,
				folded.map((r) => ({
					bucket: num(r.day) * 24,
					host: r.host,
					path: r.path,
					requests: num(r.requests),
					last_seen: num(r.last_seen),
				})),
			);
			for (const table of [
				"traffic_hour",
				"traffic_country_hour",
				"traffic_asn_hour",
				"traffic_ip_hour",
				"traffic_path_hour",
			]) {
				await trx(table).where("bucket", "<", hourBefore).del();
			}
			await trx("traffic_visitor")
				.where("day", "<", Math.floor(now / DAY) - retentionDays)
				.del();
		});
	};

	const deleteIps = () => knex("traffic_ip_hour").del();

	const deleteVisitors = async () => {
		await knex("traffic_visitor").del();
	};

	/**
	 * Deletes every stored missing page, one week of buckets per statement with a yield in between, so a large table
	 * never holds the connection (the only one on SQLite) or the event loop for long. Runs inside the traffic queue.
	 */
	const deletePaths = async () => {
		const [range] = await knex("traffic_path_hour").min({ low: "bucket" }).max({ high: "bucket" });
		if (range?.low === null || range?.low === undefined) return;
		const high = num(range.high);
		for (let from = num(range.low); from <= high; from += DELETE_SPAN) {
			await knex("traffic_path_hour")
				.where("bucket", "<", from + DELETE_SPAN)
				.del();
			await yieldToLoop();
		}
	};

	/**
	 * The hashes (lib/traffic/path-hash.js) of the stored missing page paths per (UTC day, host) of the given days,
	 * without the "(other)" row, so the counter keeps the per host and day cap across a restart. On SQLite it runs in
	 * the read worker (internal/monitoring-services.js), so the scan does not block the event loop at start.
	 *
	 * @param   {Object}    args
	 * @param   {Number[]}  args.days  UTC day numbers
	 * @returns {Promise<Array<{day: Number, host: String, hashes: Number[]}>>}
	 */
	const pathDayHashes = async ({ days }) => {
		const out = new Map();
		const rows = await knex("traffic_path_hour")
			.where("bucket", ">=", Math.min(...days) * 24)
			.where("bucket", "<", (Math.max(...days) + 1) * 24)
			.whereNot("path", OTHER_PATH)
			.select(knex.raw(`${dayOfHour} as day`), "host", "path")
			.groupByRaw(`${dayOfHour}, host, path`);
		for (const row of rows) {
			const day = num(row.day);
			if (!days.includes(day)) continue;
			const key = `${day}|${row.host}`;
			let entry = out.get(key);
			if (!entry) {
				entry = { day, host: row.host, hashes: [] };
				out.set(key, entry);
			}
			entry.hashes.push(pathHash(row.path));
		}
		return [...out.values()];
	};

	/** Deletes every stored count, top list row, IP row and visitor hash in one transaction. */
	const deleteAll = () =>
		knex.transaction(async (trx) => {
			for (const table of ALL_TABLES) {
				await trx(table).del();
			}
		});

	/**
	 * Distinct visitor hashes from startDay (UTC day number) on. The empty hash is the cap marker: it is not
	 * counted and sets `capped` when it matches the same filter. A marker stays when the cap is raised later, so a
	 * day that reached the old cap still reports `capped` while it counts more visitors.
	 *
	 * @param   {Object}         args
	 * @param   {Number}         args.startDay
	 * @param   {String[]|null}  args.hosts     host keys, null for all hosts
	 * @returns {Promise<{visitors: Number, capped: Boolean}>}
	 */
	const countVisitors = async ({ startDay, hosts = null }) => {
		const base = () => {
			const query = knex("traffic_visitor").where("day", ">=", startDay);
			return hosts === null ? query : query.whereIn("host", hosts);
		};
		const [counted] = await base().where("hash", "<>", "").countDistinct({ visitors: "hash" });
		const marker = await base().where("hash", "").first("id");
		return { visitors: num(counted?.visitors ?? 0), capped: Boolean(marker) };
	};

	/**
	 * Stored visitor hashes (without the empty marker) and the cap marker per (day, host) for the given days, so
	 * the counter can keep the per day cap across restarts without counting returning visitors twice.
	 *
	 * @param   {Object}    args
	 * @param   {Number[]}  args.days  UTC day numbers
	 * @returns {Promise<Array<{day: Number, host: String, hashes: String[], capped: Boolean}>>}
	 */
	const visitorDayHashes = async ({ days }) => {
		const out = new Map();
		const entry = (day, host) => {
			const key = `${day}|${host}`;
			let row = out.get(key);
			if (!row) {
				row = { day: num(day), host, hashes: [], capped: false };
				out.set(key, row);
			}
			return row;
		};
		const stored = await knex("traffic_visitor")
			.whereIn("day", days)
			.where("hash", "<>", "")
			.select("day", "host", "hash");
		for (const row of stored) entry(row.day, row.host).hashes.push(row.hash);
		const markers = await knex("traffic_visitor").whereIn("day", days).where("hash", "").distinct("day", "host");
		for (const row of markers) entry(row.day, row.host).capped = true;
		return [...out.values()];
	};

	const toRows = (rows) =>
		rows.map((r) => ({
			...r,
			bucket: num(r.bucket),
			requests: num(r.requests),
			bytes: num(r.bytes),
		}));

	/**
	 * Requests and bytes per bucket and status class, summed in SQL: minute buckets, or with hourly the minute rows
	 * summed per hour. Grouped by the expression, not an alias (Postgres would take the column of the same name).
	 */
	const seriesRows = async (table, from, host, { hourly = false } = {}) => {
		const bucket = hourly ? hourOfMinute : "bucket";
		const query = knex(table)
			.where("bucket", ">=", from)
			.select(knex.raw(`${bucket} as bucket`), "status_class")
			.sum({ requests: "requests", bytes: "bytes" })
			.groupByRaw(`${bucket}, status_class`);
		return toRows(await hostFilter(query, host));
	};

	/** Requests and bytes per host key, summed in SQL. */
	const hostRows = async (table, from, host) => {
		const query = knex(table)
			.where("bucket", ">=", from)
			.select("host")
			.sum({ requests: "requests", bytes: "bytes" })
			.groupBy("host");
		return toRows(await hostFilter(query, host)).map(({ bucket: _bucket, ...row }) => row);
	};

	/** Series and per host sums from startHour on: stored hour rows plus the minute rows not rolled up yet. */
	const hourSeries = async (startHour, host) => [
		...(await seriesRows("traffic_hour", startHour, host)),
		...(await seriesRows("traffic_minute", startHour * 60, host, { hourly: true })),
	];

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

	/**
	 * The ten most requested missing paths from startHour on, newest time each, sorted and cut in SQL. With wholeDays
	 * (7d, 30d) the range starts at the first hour of its first UTC day, because rows of days before yesterday are day
	 * rows: like the other top lists the range can include up to one extra partial day.
	 */
	const topPaths = async (startHour, host, { wholeDays = false } = {}) => {
		const from = wholeDays ? Math.floor(startHour / 24) * 24 : startHour;
		const query = knex("traffic_path_hour")
			.where("bucket", ">=", from)
			.groupBy("path")
			.select("path")
			.sum({ requests: "requests" })
			.max({ last_seen: "last_seen" })
			.orderByRaw("sum(requests) desc, path asc")
			.limit(TOP);
		return (await hostFilter(query, host)).map((r) => ({
			path: r.path,
			requests: num(r.requests),
			last_seen: new Date(num(r.last_seen) * 1000).toISOString(),
		}));
	};

	const queryTraffic = async ({ range, host = "", showIps = false, paths = false, now = Date.now() }) => {
		const spec = RANGES[range];
		if (!spec) {
			throw new Error(`Unknown range ${range}`);
		}
		const size = spec.unit === "minute" ? MINUTE : HOUR;
		const current = Math.floor(now / size);
		const start = current - spec.count + 1;
		const startHour = Math.floor((start * size) / HOUR);

		let rows;
		let hostSums;
		if (spec.unit === "minute") {
			rows = await seriesRows("traffic_minute", start, host);
			hostSums = await hostRows("traffic_minute", start, host);
		} else {
			rows = await hourSeries(start, host);
			hostSums = [
				...(await hostRows("traffic_hour", start, host)),
				...(await hostRows("traffic_minute", start * 60, host)),
			];
		}
		rows = rows.filter((r) => r.bucket >= start);

		const totals = {
			requests: rows.reduce((n, r) => n + r.requests, 0),
			bytes: rows.reduce((n, r) => n + r.bytes, 0),
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
			// every host key of the range, sorted by requests: the API groups them per NPMpro host before trimming
			hosts: sumBy(
				hostSums,
				(r) => r.host,
				(r) => ({ host: r.host, requests: 0, bytes: 0 }),
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
			// 1h and 24h read only the last 25 hours, which are never folded into day rows
			...(paths ? { top_404_paths: await topPaths(startHour, host, { wholeDays: spec.unit === "hour" }) } : {}),
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
		const rows = (await hourSeries(startHour, "")).filter((r) => r.bucket >= startHour);
		const today = rows.filter((r) => r.bucket >= todayHour);
		const countries = await hourTop("traffic_country_hour", todayHour, "", ["country"]);
		const best = sumBy(
			countries,
			(r) => r.country,
			(r) => ({ country: r.country, requests: 0 }),
		).find((r) => r.country !== "--");
		return {
			requests_today: today.reduce((n, r) => n + r.requests, 0),
			series_24h: fillSeries(rows, startHour, 24).map((p) => ({
				bucket: p.bucket,
				requests: Object.values(p.by_class).reduce((a, b) => a + b, 0),
			})),
			error_rate_today: errorRate(today),
			top_country_today: best ? best.country : null,
		};
	};

	return {
		flush,
		rollUpAndPrune,
		deleteIps,
		deleteVisitors,
		deletePaths,
		deleteAll,
		countVisitors,
		visitorDayHashes,
		pathDayHashes,
		queryTraffic,
		summary,
	};
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
export const deleteVisitors = lazy("deleteVisitors");
export const deletePaths = lazy("deletePaths");
export const deleteAll = lazy("deleteAll");
export const countVisitors = lazy("countVisitors");
export const visitorDayHashes = lazy("visitorDayHashes");
export const pathDayHashes = lazy("pathDayHashes");
export const queryTraffic = lazy("queryTraffic");
export const summary = lazy("summary");
