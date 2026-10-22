import * as api from "./base";

export async function createDnsCredential(item) {
	return await api.post({ url: "/nginx/dns-credentials", data: item });
}
