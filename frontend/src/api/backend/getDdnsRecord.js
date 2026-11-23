import * as api from "./base";

export async function getDdnsRecord(id, expand, params = {}) {
	return await api.get({ url: `/nginx/ddns-records/${id}`, params: { expand: expand?.join(","), ...params } });
}
