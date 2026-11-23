import * as api from "./base";

export async function getProviderDomains(id) {
	return await api.get({ url: `/nginx/dns-credentials/${id}/provider-domains` });
}
