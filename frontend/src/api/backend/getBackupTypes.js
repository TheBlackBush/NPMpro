import * as api from "./base";

export async function getBackupTypes() {
	return await api.get({ url: "/backups/types" });
}
