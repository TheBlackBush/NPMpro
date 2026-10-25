import { environmentInfo } from "../lib/environment-info.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { RUNTIME_GROUPS } from "../lib/runtime-rules.js";

const internalEnvironment = {
	/**
	 * Startup environment variables (secret values are never included) and the runtime settings locked by env
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	get: async (access) => {
		access.canAdmin();
		const runtimeLocked = [];
		for (const group of RUNTIME_GROUPS) {
			const { locked, locked_by: lockedBy, locked_reason: lockedReason } = await getRuntimeConfig(group);
			for (const key of locked) {
				runtimeLocked.push({ group, key, env: lockedBy?.[key], reason: lockedReason?.[key] ?? null });
			}
		}
		return environmentInfo(process.env, runtimeLocked);
	},
};

export default internalEnvironment;
