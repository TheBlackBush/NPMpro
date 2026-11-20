import * as api from "./base";

export async function getAcmeSettings() {
	return await api.get({
		url: "/settings/acme",
	});
}
