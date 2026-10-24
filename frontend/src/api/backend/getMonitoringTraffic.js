import * as api from "./base";

export async function getMonitoringTraffic(range = "24h", host = "") {
	// Host keys (wildcards such as *.example.com, _other) are sent exactly as the API returned them
	return await api.get({
		url: "/monitoring/traffic",
		params: { range, host },
	});
}
