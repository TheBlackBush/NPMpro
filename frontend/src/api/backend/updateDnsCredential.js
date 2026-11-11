import * as api from "./base";

export async function updateDnsCredential(item) {
	const { id, ...data } = item;
	return await api.put({ url: `/nginx/dns-credentials/${id}`, data });
}
