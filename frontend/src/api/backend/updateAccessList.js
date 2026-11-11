import * as api from "./base";

export async function updateAccessList(item) {
	const { id, ...data } = item;

	return await api.put({
		url: `/nginx/access-lists/${id}`,
		data,
	});
}
