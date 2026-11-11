import * as api from "./base";

export async function updateSetting(item) {
	const { id, ...data } = item;

	return await api.put({
		url: `/settings/${id}`,
		data,
	});
}
