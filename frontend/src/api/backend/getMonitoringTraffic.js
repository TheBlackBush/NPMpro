import * as api from "./base";

/**
 * filter: { hostType, hostId } (a proxy, redirection or 404 host), { host: "_other" } or {} for all hosts.
 * A plain string is a host key, sent exactly as the API returned it (wildcards such as *.example.com, _other).
 */
export async function getMonitoringTraffic(range = "24h", filter = {}) {
	const params = { range };
	if (typeof filter === "string") {
		params.host = filter;
	} else if (filter?.hostType && filter?.hostId) {
		params.host_type = filter.hostType;
		params.host_id = filter.hostId;
	} else if (filter?.host) {
		params.host = filter.host;
	}
	return await api.get({ url: "/monitoring/traffic", params });
}
