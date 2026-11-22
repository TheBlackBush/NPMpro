import * as api from "./base";

export async function createDnsDomains(data) {
	return await api.post({ url: "/nginx/dns-domains", data });
}
