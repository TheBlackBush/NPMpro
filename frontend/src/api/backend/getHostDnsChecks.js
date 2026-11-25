import * as api from "./base";

/** The cached DNS checks of the hosts the user may view (no lookup runs) */
export async function getHostDnsChecks() {
	return await api.get({ url: "/nginx/dns-check/hosts" });
}
