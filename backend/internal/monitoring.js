/**
 * The /api/monitoring responses (administrators only). Built from the running services, so it has no
 * imports of its own; internal/monitoring-services.js creates the instance the routes use.
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.traffic    traffic service: status()
 * @param   {Object}    deps.crowdsec   CrowdSec service: result()
 * @param   {Object}    deps.geoip      createGeoip() instance: available()
 * @param   {Object}    deps.store      { queryTraffic, summary } (lib/traffic/store.js)
 * @param   {Function}  deps.getConfig  () => Promise<{ values: { traffic_enabled, show_ips } }>
 * @param   {Function}  [deps.now]
 * @returns {Object}
 */
const TRAFFIC_CACHE_MS = 30000;

const createMonitoring = ({ traffic, crowdsec, geoip, store, getConfig, now = Date.now }) => {
	// queryTraffic results per (range, host, show_ips) for 30 s: the page refreshes every minute per open tab,
	// the counts change once a minute (flush)
	const trafficCache = new Map();

	const cachedTraffic = (range, host, showIps) => {
		const time = now();
		for (const [key, hit] of trafficCache) {
			if (time - hit.at >= TRAFFIC_CACHE_MS) trafficCache.delete(key);
		}
		const key = JSON.stringify([range, host, showIps]);
		let hit = trafficCache.get(key);
		if (!hit) {
			hit = { at: time, result: store.queryTraffic({ range, host, showIps, now: time }) };
			trafficCache.set(key, hit);
			// a failed query is not cached
			hit.result.catch(() => {
				if (trafficCache.get(key) === hit) trafficCache.delete(key);
			});
		}
		return hit.result;
	};

	// store.summary() for 30 s: the dashboard polls it every minute per open tab and it reads 24 h of minute rows
	let summaryHit = null;

	const cachedSummary = () => {
		const time = now();
		if (!summaryHit || time - summaryHit.at >= TRAFFIC_CACHE_MS) {
			const hit = { at: time, result: store.summary({ now: time }) };
			summaryHit = hit;
			// a failed query is not cached
			hit.result.catch(() => {
				if (summaryHit === hit) summaryHit = null;
			});
		}
		return summaryHit.result;
	};

	const geoipAvailable = () => {
		const available = geoip.available();
		return Boolean(available.country || available.asn);
	};

	return {
		/**
		 * @param   {Access}  access
		 * @param   {{range: string, host: string}}  query
		 */
		getTraffic: async (access, { range, host = "" }) => {
			access.canAdmin();
			const { values } = await getConfig();
			const showIps = Boolean(values.show_ips);
			const { top_ips: topIps, countries, ...data } = structuredClone(await cachedTraffic(range, host, showIps));
			// visitors_error is not part of the API yet
			const { enabled: _running, visitors_error: _visitorsError, ...status } = traffic.status();
			return {
				...data,
				// an array, not an object keyed by code: the UI converts object keys and "--" is not a valid key there
				countries: Object.entries(countries)
					.map(([country, requests]) => ({ country, requests }))
					.sort((a, b) => b.requests - a.requests),
				...(showIps ? { top_ips: topIps } : {}),
				status: { ...status, enabled: Boolean(values.traffic_enabled), geoip: geoipAvailable() },
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
			};
			if (values.traffic_enabled) {
				const today = structuredClone(await cachedSummary());
				out.requests_today = today.requests_today;
				out.series_24h = today.series_24h;
				out.error_rate_today = today.error_rate_today;
				out.top_country_today = geoipAvailable() ? today.top_country_today : null;
			}
			return out;
		},
	};
};

export { createMonitoring };
