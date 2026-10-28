import * as api from "./base";

export async function getBackupSchedules() {
	return await api.get({ url: "/backups/schedules" });
}
