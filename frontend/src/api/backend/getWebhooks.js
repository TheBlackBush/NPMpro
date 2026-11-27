import * as api from "./base";

export async function getWebhooks() {
	return await api.get({
		url: "/webhooks",
	});
}
