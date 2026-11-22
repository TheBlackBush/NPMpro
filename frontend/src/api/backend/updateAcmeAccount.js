import * as api from "./base";

export async function updateAcmeAccount(id, values) {
	return await api.put({
		url: `/settings/acme/accounts/${id}`,
		data: values,
	});
}
