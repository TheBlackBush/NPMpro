import * as api from "./base";

export async function registerAcmeAccount(server) {
	return await api.post({
		url: "/settings/acme/register",
		data: server ? { server } : {},
	});
}
