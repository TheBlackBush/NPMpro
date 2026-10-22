import * as api from "./base";

export async function getDnsCredentials(expand, params = {}) {
	return await api.get({ url: "/nginx/dns-credentials", params: { expand: expand?.join(","), ...params } });
}
