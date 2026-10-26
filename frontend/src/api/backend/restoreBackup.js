import * as api from "./base";

export async function restoreBackup(token, types) {
	return await api.post({ url: `/backups/restore/${encodeURIComponent(token)}`, data: { types, confirm: true } });
}
