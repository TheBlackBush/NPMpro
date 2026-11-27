import * as api from "./base";

// the answer holds the signing secret once
export async function createWebhook(data) {
	return await api.post({
		url: "/webhooks",
		data,
	});
}
