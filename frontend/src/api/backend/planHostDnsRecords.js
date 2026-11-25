import * as api from "./base";

/**
 * Plans the DNS records of a host's names: what each name can get, and this server's public addresses (reads only)
 *
 * @param {{ hostType: string, hostId?: number, names: string[] }} options  hostType: proxy_host, redirection_host or
 *        dead_host; hostId is left out for a host that is not saved yet
 */
export async function planHostDnsRecords({ hostType, hostId, names }) {
	return await api.post({ url: "/nginx/dns-check/plan", data: { hostType, hostId, names } });
}
