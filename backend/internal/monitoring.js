import errs from "../lib/error.js";
import validator from "../lib/validator/index.js";
import { global as logger } from "../logger.js";

const TRAFFIC_CACHE_MS = 30000;
// 7d and 30d change little within minutes and are the expensive ones: kept longer than the page's 60 s poll
const LONG_RANGE_CACHE_MS = 5 * 60000;
const CACHE_MS = {
	"1h": TRAFFIC_CACHE_MS,
	"24h": TRAFFIC_CACHE_MS,
	"7d": LONG_RANGE_CACHE_MS,
	"30d": LONG_RANGE_CACHE_MS,
};
const TOP_HOSTS = 10;
const RECENT_LIMIT = 100;
const DAY = 86400000;
const RANGE_MS = { "1h": 3600000, "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };

const trafficQuerySchema = {
	type: "object",
	additionalProperties: false,
	required: ["range", "host"],
	properties: {
		range: { type: "string", enum: ["1h", "24h", "7d", "30d"] },
		host: { type: "string", maxLength: 255 },
		host_id: { type: "integer", minimum: 1 },
		host_type: { type: "string", enum: ["proxy", "redirection", "dead"] },
	},
	dependentRequired: { host_id: ["host_type"], host_type: ["host_id"] },
};

const present = (value) => typeof value === "string" && value !== "";

/**
 * Validates the query string of GET /api/monitoring/traffic; host_id is coerced to an integer and must come with
 * host_type (ValidationError otherwise).
 *
 * @param   {Object}  query  req.query
 * @returns {{range: string, host: string, host_id?: number, host_type?: string}}
 */
const parseTrafficQuery = (query) =>
	validator(trafficQuerySchema, {
		range: present(query.range) ? query.range : "24h",
		host: typeof query.host === "string" ? query.host.trim().toLowerCase() : "",
		...(present(query.host_id) ? { host_id: query.host_id.trim() } : {}),
		...(present(query.host_type) ? { host_type: query.host_type } : {}),
	});

/**
 * First UTC day number of the visitor counts: the current day for 1h (visitors are stored per day), otherwise
 * the day the range starts on.
 */
const visitorStartDay = (range, time) => Math.floor((range === "1h" ? time : time - RANGE_MS[range]) / DAY);

/**
 * The in-memory recent requests for the API: names from the host resolver, ISO times, no IP while IPs are off.
 *
 * @param   {Object[]}  entries  traffic.recent() entries
 * @param   {Object}    resolver  createHostResolver() instance
 * @param   {boolean}   showIps
 * @returns {Object[]}
 */
const recentRequests = (entries, resolver, showIps) =>
	entries.map((entry) => {
		const owner = resolver.ownerOf(entry.host);
		return {
			time: new Date(entry.time).toISOString(),
			host_id: owner.host_id,
			host_type: owner.host_type,
			name: owner.name,
			method: entry.method,
			path: entry.path,
			status: entry.status,
			bytes: entry.bytes,
			country: entry.country,
			...(showIps && entry.ip !== undefined ? { ip: entry.ip } : {}),
		};
	});

/**
 * Sums the per key rows of the store per NPMpro host (or deleted key, or _other), sorted by requests.
 *
 * @param   {Array<{host: string, requests: number, bytes: number}>}  rows
 * @param   {Object}  resolver  createHostResolver() instance
 * @returns {Array<Object>}  entries with the stored keys to count visitors over in `keys`
 */
const groupHosts = (rows, resolver) => {
	const groups = new Map();
	for (const row of rows) {
		const owner = resolver.ownerOf(row.host);
		const id = `${owner.host_type}|${owner.host_id ?? owner.name}`;
		let entry = groups.get(id);
		if (!entry) {
			entry = { ...owner, requests: 0, bytes: 0, keys: [] };
			groups.set(id, entry);
		}
		entry.requests += row.requests;
		entry.bytes += row.bytes;
		entry.keys.push(row.host);
	}
	// visitors of a real host count over all its names, also those without requests in the range
	for (const entry of groups.values()) {
		if (entry.host_id === null) continue;
		const owned = resolver.keysFor(entry.host_type, entry.host_id) ?? [];
		entry.keys = [...new Set([...owned, ...entry.keys])];
	}
	return [...groups.values()].sort((a, b) => b.requests - a.requests);
};

/**
 * The /api/monitoring responses (administrators only). Built from the running services; internal/monitoring-services.js
 * creates the instance the routes use.
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.traffic    traffic service: status(), hostResolver(), recent()
 * @param   {Object}    deps.crowdsec   CrowdSec service: result()
 * @param   {Object}    deps.geoip      createGeoip() instance: available()
 * @param   {Object}    deps.store      { queryTraffic, summary, countVisitors } (lib/traffic/store.js)
 * @param   {Function}  deps.getConfig  () => Promise<{ values: { traffic_enabled, show_ips, unique_visitors } }>
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.log]
 * @returns {Object}
 */
const createMonitoring = ({ traffic, crowdsec, geoip, store, getConfig, now = Date.now, log = logger }) => {
	// results per (range, filter, show_ips, unique_visitors), 30 s for 1h and 24h and 5 minutes for 7d and 30d: the
	// page refreshes every minute per open tab, the counts change once a minute (flush)
	const trafficCache = new Map();

	const cached = (cache, key, compute, ttl = TRAFFIC_CACHE_MS) => {
		const time = now();
		for (const [k, hit] of cache) {
			if (time - hit.at >= hit.ttl) cache.delete(k);
		}
		let hit = cache.get(key);
		if (!hit) {
			hit = { at: time, ttl, result: compute(time) };
			cache.set(key, hit);
			// a failed query is not cached
			hit.result.catch(() => {
				if (cache.get(key) === hit) cache.delete(key);
			});
		}
		return hit.result;
	};

	const computeTraffic = async ({ range, keys, showIps, uniqueVisitors, resolver }, time) => {
		const data = await store.queryTraffic({ range, host: keys, showIps, now: time });
		const { hosts, ...rest } = data;
		const entries = groupHosts(hosts, resolver).slice(0, TOP_HOSTS);
		if (!uniqueVisitors) {
			return { ...rest, top_hosts: entries.map(({ keys: _keys, ...entry }) => entry) };
		}
		const startDay = visitorStartDay(range, time);
		let selected = null;
		if (Array.isArray(keys)) selected = keys;
		else if (keys) selected = [keys];
		const total = await store.countVisitors({ startDay, hosts: selected });
		const topHosts = [];
		for (const { keys: entryKeys, ...entry } of entries) {
			const counted = await store.countVisitors({ startDay, hosts: entryKeys });
			topHosts.push({ ...entry, visitors: counted.visitors, visitors_capped: counted.capped });
		}
		return {
			...rest,
			totals: { ...rest.totals, visitors: total.visitors, visitors_capped: total.capped },
			top_hosts: topHosts,
		};
	};

	// store.summary() and the visitors of today for 30 s: the dashboard polls every minute per open tab and the
	// summary reads 24 h of minute rows
	const summaryCache = new Map();

	const computeSummary = async (uniqueVisitors, time) => {
		const today = await store.summary({ now: time });
		let visitors = null;
		if (uniqueVisitors) {
			try {
				visitors = (await store.countVisitors({ startDay: Math.floor(time / DAY), hosts: null })).visitors;
			} catch (err) {
				// the other dashboard numbers stay available; retried when the cached summary expires
				log.error(`Monitoring: could not count the visitors of today: ${err.message}`);
			}
		}
		return { ...today, visitors_today: visitors };
	};

	const geoipAvailable = () => {
		const available = geoip.available();
		return Boolean(available.country || available.asn);
	};

	return {
		/** Drops the cached traffic results and dashboard numbers (the stored statistics were deleted). */
		clearCaches: () => {
			trafficCache.clear();
			summaryCache.clear();
		},

		/**
		 * @param   {Access}  access
		 * @param   {{range: string, host?: string, host_id?: number, host_type?: string}}  query  host_id with
		 *          host_type selects one NPMpro host (all its domain names) and overrides host
		 */
		getTraffic: async (access, { range, host = "", host_id: hostId = null, host_type: hostType = null }) => {
			access.canAdmin();
			const { values } = await getConfig();
			const showIps = Boolean(values.show_ips);
			const uniqueVisitors = Boolean(values.unique_visitors);
			const resolver = await traffic.hostResolver();
			let keys = host;
			const byHost = hostId !== null && hostType !== null;
			if (byHost) {
				keys = resolver.keysFor(hostType, hostId);
				if (keys === null) throw new errs.ItemNotFoundError(hostId);
			}
			// host is ignored when host_id and host_type select the host
			const key = JSON.stringify([range, byHost ? null : host, hostType, hostId, keys, showIps, uniqueVisitors]);
			const {
				top_ips: topIps,
				countries,
				...data
			} = structuredClone(
				await cached(
					trafficCache,
					key,
					(time) => computeTraffic({ range, keys, showIps, uniqueVisitors, resolver }, time),
					CACHE_MS[range],
				),
			);
			const { enabled: _running, ...status } = traffic.status();
			// not cached: the newest requests of the selected host (all its keys) or of all hosts, for any range
			let recentKeys = null;
			if (byHost) recentKeys = keys;
			else if (host) recentKeys = [host];
			return {
				...data,
				// an array, not an object keyed by code: the UI converts object keys and "--" is not a valid key there
				countries: Object.entries(countries)
					.map(([country, requests]) => ({ country, requests }))
					.sort((a, b) => b.requests - a.requests),
				...(showIps ? { top_ips: topIps } : {}),
				recent: recentRequests(traffic.recent({ keys: recentKeys, limit: RECENT_LIMIT }), resolver, showIps),
				status: {
					...status,
					enabled: Boolean(values.traffic_enabled),
					geoip: geoipAvailable(),
					unique_visitors: uniqueVisitors,
				},
			};
		},

		/**
		 * @param   {Access}  access
		 */
		getCrowdsec: (access) => {
			access.canAdmin();
			return crowdsec.result();
		},

		/**
		 * Dashboard numbers; a field is null when its source is off or unavailable
		 *
		 * @param   {Access}  access
		 */
		getSummary: async (access) => {
			access.canAdmin();
			const { values } = await getConfig();
			const bans = crowdsec.result();
			const out = {
				requests_today: null,
				series_24h: null,
				error_rate_today: null,
				active_bans: bans.configured && bans.reachable ? bans.total : null,
				top_country_today: null,
				visitors_today: null,
			};
			if (values.traffic_enabled) {
				const uniqueVisitors = Boolean(values.unique_visitors);
				const today = structuredClone(
					await cached(summaryCache, JSON.stringify([uniqueVisitors]), (time) =>
						computeSummary(uniqueVisitors, time),
					),
				);
				out.requests_today = today.requests_today;
				out.series_24h = today.series_24h;
				out.error_rate_today = today.error_rate_today;
				out.top_country_today = geoipAvailable() ? today.top_country_today : null;
				out.visitors_today = today.visitors_today;
			}
			return out;
		},
	};
};

export { createMonitoring, parseTrafficQuery };
