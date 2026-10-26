import * as api from "./base";

export async function deleteBackup(name) {
	return await api.del({ url: `/backups/${encodeURIComponent(name)}` });
}
