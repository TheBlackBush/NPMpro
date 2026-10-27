import * as api from "./base";

export async function downloadBackup(name) {
	await api.download({ url: `/backups/${encodeURIComponent(name)}` }, name);
}
