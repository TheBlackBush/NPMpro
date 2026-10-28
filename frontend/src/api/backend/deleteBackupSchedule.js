import * as api from "./base";

/**
 * @param {number}  id
 * @param {boolean} files  also delete the schedule's stored backups (409 while a backup or restore runs); without,
 *                         they stay as plain stored backups
 */
export async function deleteBackupSchedule(id, files) {
	return await api.del({ url: `/backups/schedules/${id}${files ? "?files=true" : ""}` });
}
