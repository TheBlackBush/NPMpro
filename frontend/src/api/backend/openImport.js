import * as api from "./base";

/**
 * @param {string} id
 * @param {string} [passphrase]
 * @returns {Promise<{ token: string, summary: object, manifest: object, plan: object }>}
 */
export async function openImport(id, passphrase) {
	return await api.post({ url: `/backups/import/${encodeURIComponent(id)}/open`, data: { passphrase } });
}
