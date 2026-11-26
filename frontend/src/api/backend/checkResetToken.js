import * as api from "./base";

export async function checkResetToken(token) {
	return await api.post({
		url: "/password-reset/check",
		data: { token },
	});
}
