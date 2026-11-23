import * as api from "./base";

export async function createDdnsRecord(data) {
	return await api.post({ url: "/nginx/ddns-records", data });
}
