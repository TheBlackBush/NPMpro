import * as api from "./base";

export async function addAcmeAccount(values) {
	return await api.post({
		url: "/settings/acme/accounts",
		data: values,
	});
}
