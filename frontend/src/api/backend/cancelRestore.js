import * as api from "./base";

export async function cancelRestore(token) {
	return await api.del({ url: `/backups/restore/${encodeURIComponent(token)}` });
}
