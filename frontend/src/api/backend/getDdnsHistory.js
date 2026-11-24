import * as api from "./base";

export async function getDdnsHistory(id) {
	return await api.get({ url: `/nginx/ddns-records/${id}/history` });
}
