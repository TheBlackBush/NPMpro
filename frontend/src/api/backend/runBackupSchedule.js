import * as api from "./base";

/**
 * Runs the schedule now; resolves when the backup is finished, with the updated schedule
 */
export async function runBackupSchedule(id) {
	return await api.post({ url: `/backups/schedules/${id}/run` });
}
