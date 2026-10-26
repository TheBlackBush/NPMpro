import * as api from "./base";

export async function getBackups() {
	return await api.get({ url: "/backups" });
}
