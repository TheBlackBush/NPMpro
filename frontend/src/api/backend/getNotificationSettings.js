import * as api from "./base";

export async function getNotificationSettings() {
	return await api.get({
		url: "/settings/notifications",
	});
}
