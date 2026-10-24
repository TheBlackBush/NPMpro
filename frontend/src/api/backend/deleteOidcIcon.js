import * as api from "./base";

export async function deleteOidcIcon() {
	return await api.del({
		url: "/settings/oidc/icon",
	});
}
