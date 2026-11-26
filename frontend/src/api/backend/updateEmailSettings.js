import * as api from "./base";

export async function updateEmailSettings(values) {
	return await api.put({
		url: "/settings/email",
		data: values,
	});
}
