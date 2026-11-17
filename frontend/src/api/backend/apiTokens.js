import * as api from "./base";

export async function getOwnApiTokens() {
	return await api.get({
		url: "/users/me/api-tokens",
	});
}

export async function createApiToken(data) {
	return await api.post({
		url: "/users/me/api-tokens",
		data,
	});
}

export async function revokeOwnApiToken(id) {
	return await api.del({
		url: `/users/me/api-tokens/${id}`,
	});
}

export async function getApiTokens() {
	return await api.get({
		url: "/api-tokens",
	});
}

export async function revokeApiToken(id) {
	return await api.del({
		url: `/api-tokens/${id}`,
	});
}
