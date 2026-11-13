import * as api from "./base";

export async function getLandingPages() {
	return await api.get({ url: "/settings/landing-pages" });
}
