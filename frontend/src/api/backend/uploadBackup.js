import * as api from "./base";

/**
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]
 * @param {AbortController} [abortController]
 */
export async function uploadBackup(file, onProgress, abortController) {
	return await api.upload({ url: "/backups/upload", params: { name: file.name }, file, onProgress }, abortController);
}
