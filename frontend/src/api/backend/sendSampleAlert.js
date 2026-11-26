import * as api from "./base";

export async function sendSampleAlert() {
	return await api.post({
		url: "/settings/notifications/test-alert",
		data: {},
	});
}
