import * as api from "./base";

export async function updateAcmeSettings(values) {
	return await api.put({
		url: "/settings/acme",
		data: values,
	});
}
