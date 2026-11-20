import * as api from "./base";

export async function replaceAcmeAccount(values) {
	return await api.post({
		url: "/settings/acme/replace",
		data: values,
	});
}
