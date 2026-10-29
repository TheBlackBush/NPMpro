import * as api from "./base";

export async function getDatabase() {
	return await api.get({ url: "/database" });
}
