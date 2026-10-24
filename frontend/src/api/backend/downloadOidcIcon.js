import * as api from "./base";

export async function downloadOidcIcon(url) {
	return await api.post({
		url: "/settings/oidc/icon/url",
		data: { url },
	});
}
