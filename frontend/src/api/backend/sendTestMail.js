import * as api from "./base";

export async function sendTestMail(to) {
	return await api.post({
		url: "/settings/email/test",
		data: to ? { to } : {},
	});
}
