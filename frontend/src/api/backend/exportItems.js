import * as api from "./base";

/**
 * @param {{ kind: string, ids: Array<number | string>, linked: object, secrets: boolean, passphrase?: string }} data
 * @returns {Promise<{ pending: string, name: string }>}
 */
export async function exportItems({ kind, ids, linked, secrets, passphrase }) {
	return await api.post({ url: "/backups/export", data: { kind, ids, linked, secrets, passphrase } });
}
