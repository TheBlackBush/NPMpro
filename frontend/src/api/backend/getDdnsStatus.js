import * as api from "./base";

export async function getDdnsStatus() {
	return await api.get({ url: "/nginx/ddns/status" });
}
