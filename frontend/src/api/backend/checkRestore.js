import * as api from "./base";

export async function checkRestore(token, types) {
	return await api.post({ url: `/backups/restore/${encodeURIComponent(token)}/check`, data: { types } });
}
