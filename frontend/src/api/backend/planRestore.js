import * as api from "./base";

/**
 * Dry run of a merge restore.
 * @param {string} token
 * @param {{ types: string[], items?: object, choices?: object }} options
 */
export async function planRestore(token, { types, items, choices }) {
	return await api.post({
		url: `/backups/restore/${encodeURIComponent(token)}/plan`,
		data: { mode: "merge", types, items, choices },
	});
}
