import * as api from "./base";

export async function updateDdnsRecord(item) {
	const { id, ...data } = item;
	return await api.put({ url: `/nginx/ddns-records/${id}`, data });
}
