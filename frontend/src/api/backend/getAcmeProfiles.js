import * as api from "./base";

export async function getAcmeProfiles(server) {
	return await api.get({
		url: "/settings/acme/profiles",
		params: server ? { server } : {},
	});
}
