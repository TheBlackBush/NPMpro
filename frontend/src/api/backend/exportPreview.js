import * as api from "./base";

/**
 * @param {string} kind
 * @param {Array<number | string>} [ids]
 * @returns {Promise<{ items: Array<{ id: number | string, label: string }>, linked: object[], secretsAllowed: boolean }>}
 */
export async function exportPreview(kind, ids) {
	return await api.post({ url: "/backups/export/preview", data: { kind, ids } });
}
