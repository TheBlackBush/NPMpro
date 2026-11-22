import * as api from "./base";

export async function getDnsDomainSuggestions() {
	return await api.get({ url: "/nginx/dns-domains/suggestions" });
}
