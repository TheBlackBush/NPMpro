import * as api from "./base";

export async function getDdnsProviders() {
	return await api.get({ url: "/nginx/ddns/providers" });
}
