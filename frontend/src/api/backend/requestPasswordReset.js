import * as api from "./base";

// answers 202 with no body (null) whether or not the account exists
export async function requestPasswordReset(email) {
	return await api.post({
		url: "/password-reset",
		data: { email },
	});
}
