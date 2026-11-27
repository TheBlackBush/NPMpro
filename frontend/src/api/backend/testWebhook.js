import * as api from "./base";

export async function testWebhook(id) {
	return await api.post({
		url: `/webhooks/${id}/test`,
		data: {},
	});
}
