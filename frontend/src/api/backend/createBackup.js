import * as api from "./base";

/**
 * @param {{ types: string[], secrets: boolean, passphrase?: string, keep: boolean }} data
 * @returns {Promise<{ entry: object } | { pending: string, name: string }>}
 */
export async function createBackup(data) {
	return await api.post({ url: "/backups", data });
}
