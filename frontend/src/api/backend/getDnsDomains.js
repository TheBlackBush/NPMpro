import * as api from "./base";

export async function getDnsDomains(expand, params = {}) {
	return await api.get({ url: "/nginx/dns-domains", params: { expand: expand?.join(","), ...params } });
}
