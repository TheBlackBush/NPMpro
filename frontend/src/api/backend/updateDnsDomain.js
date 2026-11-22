import * as api from "./base";

export async function updateDnsDomain(item) {
	const { id, ...data } = item;
	return await api.put({ url: `/nginx/dns-domains/${id}`, data });
}
