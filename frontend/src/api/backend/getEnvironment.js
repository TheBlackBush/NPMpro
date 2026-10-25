import * as api from "./base";

export async function getEnvironment() {
	return await api.get({
		url: "/settings/environment",
	});
}
