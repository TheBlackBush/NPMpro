import * as api from "./base";

export async function getDdnsSuggestions() {
	return await api.get({ url: "/nginx/ddns/suggestions" });
}
