import * as api from "./base";

export async function setPermissions(userId, data) {
	return await api.put({
		url: `/users/${userId}/permissions`,
		data,
	});
}
