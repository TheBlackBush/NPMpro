import * as api from "./base";

/**
 * Checks where the names of hosts point (1 to 50 hosts)
 *
 * @param {Array<{ type: string, id: number }>} hosts  type is proxy, redirection or dead
 */
export async function checkHostDns(hosts) {
	return await api.post({ url: "/nginx/dns-check/hosts", data: { hosts } });
}
