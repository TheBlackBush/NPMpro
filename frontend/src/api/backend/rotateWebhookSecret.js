import * as api from "./base";

// the answer holds the new signing secret once
export async function rotateWebhookSecret(id) {
	return await api.post({
		url: `/webhooks/${id}/rotate-secret`,
		data: {},
	});
}
