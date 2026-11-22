import * as api from "./base";

export async function deleteDnsDomain(id) {
	return await api.del({ url: `/nginx/dns-domains/${id}` });
}
