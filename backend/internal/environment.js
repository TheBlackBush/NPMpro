import { environmentInfo, settingLocksOf } from "../lib/environment-info.js";
import { getGeoipConfig, getMonitoringConfig } from "../lib/monitoring-config.js";
import { getOidcConfig } from "../lib/oidc-config.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { RUNTIME_GROUPS } from "../lib/runtime-rules.js";

const internalEnvironment = {
	/**
	 * Startup environment variables (secret values are never included) and the settings locked by env (runtime
	 * settings, OIDC, monitoring and GeoIP)
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	get: async (access) => {
		access.canAdmin();
		const locked = [];
		for (const group of RUNTIME_GROUPS) {
			const { locked: keys, locked_by: lockedBy, locked_reason: lockedReason } = await getRuntimeConfig(group);
			for (const key of keys) {
				locked.push({ group, key, env: lockedBy?.[key], reason: lockedReason?.[key] ?? null });
			}
		}
		locked.push(
			...settingLocksOf(process.env, {
				oidc: (await getOidcConfig()).locked,
				monitoring: (await getMonitoringConfig()).locked,
				geoip: (await getGeoipConfig()).locked,
			}),
		);
		return environmentInfo(process.env, locked);
	},
};

export default internalEnvironment;
