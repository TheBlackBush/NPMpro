import * as api from "./base";

export async function checkDdnsNow() {
	return await api.post({ url: "/nginx/ddns/check" });
}
