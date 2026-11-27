import * as api from "./base";

export async function inviteUser(id) {
	return await api.post({
		url: `/users/${id}/invite`,
	});
}
