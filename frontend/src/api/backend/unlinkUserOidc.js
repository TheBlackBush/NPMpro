import * as api from "./base";

export async function unlinkUserOidc(userId) {
	return await api.del({
		url: `/users/${userId}/oidc`,
	});
}
