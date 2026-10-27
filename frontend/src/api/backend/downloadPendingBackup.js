import * as api from "./base";

export async function downloadPendingBackup(id, name) {
	await api.download({ url: `/backups/pending/${encodeURIComponent(id)}`, params: { name } }, name);
}
