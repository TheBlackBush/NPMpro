import * as api from "./base";

export async function updateUser(item) {
	const { id, ...data } = item;

	return await api.put({
		url: `/users/${id}`,
		data,
	});
}
