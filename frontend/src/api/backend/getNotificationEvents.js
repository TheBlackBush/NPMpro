import * as api from "./base";

export async function getNotificationEvents() {
	return await api.get({
		url: "/notifications/events",
	});
}
