import * as api from "./base";

/**
 * @param {string} group   certificates, network, forward-auth, logs, advanced or ddns
 * @param {Object} payload only the keys to change (see runtimeSettingsPayload)
 */
export async function updateRuntimeSettings(group, payload) {
	return await api.put({
		url: `/settings/runtime/${group}`,
		data: payload,
	});
}
