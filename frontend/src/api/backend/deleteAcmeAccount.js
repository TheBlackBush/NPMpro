import * as api from "./base";

export async function deleteAcmeAccount(id) {
	return await api.del({
		url: `/settings/acme/accounts/${id}`,
	});
}
