import * as api from "./base";

export async function testOidcSettings(data) {
	return await api.post({
		url: "/settings/oidc/test",
		data,
	});
}
