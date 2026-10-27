import * as api from "./base";

/**
 * @param {string} kind
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]
 * @param {AbortController} [abortController]
 * @returns {Promise<{ id: string, summary: object, encrypted: boolean }>}
 */
export async function uploadImport(kind, file, onProgress, abortController) {
	return await api.upload({ url: "/backups/import", params: { kind }, file, onProgress }, abortController);
}
