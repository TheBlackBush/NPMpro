import * as api from "./base";

export async function deleteDdnsRecord(id) {
	return await api.del({ url: `/nginx/ddns-records/${id}` });
}
