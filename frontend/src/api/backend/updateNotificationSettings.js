import * as api from "./base";

export async function updateNotificationSettings(values) {
	return await api.put({
		url: "/settings/notifications",
		data: values,
	});
}
