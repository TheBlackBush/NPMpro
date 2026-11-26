import * as api from "./base";

export async function updateMyLanguage(language) {
	return await api.put({
		url: "/users/me/language",
		data: { language },
	});
}
