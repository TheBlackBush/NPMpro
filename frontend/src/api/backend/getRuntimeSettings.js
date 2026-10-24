import * as api from "./base";

export async function getRuntimeSettings(group) {
	return await api.get({
		url: `/settings/runtime/${group}`,
	});
}
