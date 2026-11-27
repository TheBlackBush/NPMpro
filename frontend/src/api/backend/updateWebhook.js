import * as api from "./base";

// the answer holds a new signing secret once when the webhook was restored without its secrets
export async function updateWebhook(id, data) {
	return await api.put({
		url: `/webhooks/${id}`,
		data,
	});
}
