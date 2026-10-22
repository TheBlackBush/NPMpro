import * as api from "./base";

export async function deleteDnsCredential(id) {
	return await api.del({ url: `/nginx/dns-credentials/${id}` });
}
