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
			const { locked } = await getRuntimeConfig(group);
			for (const key of locked) runtimeLocked.push({ group, key });
		}
		return environmentInfo(process.env, runtimeLocked);
	},
};

export default internalEnvironment;
