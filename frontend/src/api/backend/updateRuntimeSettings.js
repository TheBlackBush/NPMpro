import * as api from "./base";

/**
 * @param {string} group   certificates, network, forward-auth, logs or advanced
 * @param {Object} payload only the keys to change (see runtimeSettingsPayload)
 */
export async function updateRuntimeSettings(group, payload) {
	return await api.put({
		url: `/settings/runtime/${group}`,
		data: payload,
	});
}
