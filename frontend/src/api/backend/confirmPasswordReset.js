import * as api from "./base";

export async function confirmPasswordReset(token, password) {
	return await api.post({
		url: "/password-reset/confirm",
		data: { token, password },
	});
}
