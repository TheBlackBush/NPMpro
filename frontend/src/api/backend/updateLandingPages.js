import * as api from "./base";

export async function updateLandingPages(data) {
	return await api.put({ url: "/settings/landing-pages", data });
}
