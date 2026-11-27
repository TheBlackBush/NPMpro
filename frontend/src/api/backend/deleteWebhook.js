import * as api from "./base";

export async function deleteWebhook(id) {
	return await api.del({
		url: `/webhooks/${id}`,
	});
}
