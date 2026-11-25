import * as api from "./base";

/**
 * Probes whether a host name reaches this server (the file written and fetched at the server's public address)
 *
 * @param {{ hostType: string, hostId?: number, name: string }} options  hostType: proxy_host, redirection_host or
 *        dead_host; hostId is left out for a host that is not saved yet
 */
export async function probeHostReach({ hostType, hostId, name }) {
	return await api.post({ url: "/nginx/dns-check/reach", data: { hostType, hostId, name } });
}
