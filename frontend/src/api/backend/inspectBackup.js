import * as api from "./base";

/**
 * The body is required by the API: an empty object when there is no passphrase.
 * @returns {Promise<{ token: string, summary: object, manifest: object, preview: object }>}
 */
export async function inspectBackup(name, passphrase) {
	return await api.post({
		url: `/backups/${encodeURIComponent(name)}/inspect`,
		data: passphrase ? { passphrase } : {},
	});
}
