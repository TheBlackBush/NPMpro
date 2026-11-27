import * as api from "./base";

export async function redeliverWebhook(id, deliveryId) {
	return await api.post({
		url: `/webhooks/${id}/deliveries/${deliveryId}/redeliver`,
		data: {},
	});
}
