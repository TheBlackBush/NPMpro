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
const createMonitoring = ({ traffic, crowdsec, geoip, store, getConfig, now = Date.now }) => {
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
			const { top_ips: topIps, ...data } = await store.queryTraffic({ range, host, showIps, now: now() });
			const { enabled: _running, ...status } = traffic.status();
			return {
				...data,
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
				const today = await store.summary({ now: now() });
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
