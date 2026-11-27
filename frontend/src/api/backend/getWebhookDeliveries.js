import * as api from "./base";

// one page of the deliveries of a webhook, newest first: { data, total } (the total is X-Total-Count)
export async function getWebhookDeliveries(id, params = {}) {
	return await api.getWithTotal({
		url: `/webhooks/${id}/deliveries`,
		params,
	});
}
