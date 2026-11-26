import * as api from "./base";

export async function getEmailSettings() {
	return await api.get({
		url: "/settings/email",
	});
}
