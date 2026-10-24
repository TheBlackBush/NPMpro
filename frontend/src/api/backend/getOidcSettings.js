import * as api from "./base";

export async function getOidcSettings() {
	return await api.get({
		url: "/settings/oidc",
	});
}
