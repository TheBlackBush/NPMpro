import * as api from "./base";

/**
 * @param {number} id
 * @param {Object} data  the changed fields; an omitted passphrase keeps the stored one
 */
export async function updateBackupSchedule(id, data) {
	return await api.put({ url: `/backups/schedules/${id}`, data });
}
