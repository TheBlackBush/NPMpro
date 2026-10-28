import * as api from "./base";

/**
 * @param {Object} data  only the fields of the chosen frequency (see toPayload in src/modules/BackupSchedules.js)
 */
export async function createBackupSchedule(data) {
	return await api.post({ url: "/backups/schedules", data });
}
