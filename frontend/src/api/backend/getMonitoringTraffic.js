import { trafficParams } from "src/modules/Monitoring";
import * as api from "./base";

/**
 * filter: { hostType, hostId } (a proxy, redirection or 404 host), { host } (Other hosts or one stored key) or {}
 * for all hosts. A plain string is a host key, sent exactly as the API returned it (wildcards, _other).
 */
export async function getMonitoringTraffic(range = "24h", filter = {}) {
	return await api.get({ url: "/monitoring/traffic", params: trafficParams(range, filter) });
}
