import * as api from "./base";

export async function updateDdnsRecordNow(id) {
	return await api.post({ url: `/nginx/ddns-records/${id}/update` });
}
