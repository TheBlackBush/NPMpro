import * as api from "./base";

export async function getDdnsRecords(expand, params = {}) {
	return await api.get({ url: "/nginx/ddns-records", params: { expand: expand?.join(","), ...params } });
}
