import * as api from "./base";
import { camelizeKeys } from "./caseConvert";

/**
 * Replace restores send confirm: true; merge restores send the hash of the plan the user reviewed. A changed plan
 * answers 409 and the error carries the new plan (camelized like a normal plan) in err.payload.error.plan.
 * @param {string} token
 * @param {{ mode?: "replace" | "merge", types: string[], items?: object, choices?: object, planHash?: string }} options
 */
export async function restoreBackup(token, { mode = "replace", types, items, choices, planHash } = {}) {
	const data =
		mode === "merge" ? { mode, types, items, choices, planHash, confirm: true } : { mode, types, confirm: true };
	try {
		return await api.post({ url: `/backups/restore/${encodeURIComponent(token)}`, data });
	} catch (err) {
		const plan = err?.payload?.error?.plan;
		if (plan) err.payload.error.plan = camelizeKeys(plan, { rawKeys: api.BACKUP_RAW_KEYS });
		throw err;
	}
}
