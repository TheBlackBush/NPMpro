import * as api from "./base";

export async function getDnsCredential(id, expand) {
	return await api.get({ url: `/nginx/dns-credentials/${id}`, params: { expand: expand?.join(",") } });
}
