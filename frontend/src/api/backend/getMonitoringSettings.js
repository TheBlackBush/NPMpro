import * as api from "./base";

export async function getMonitoringSettings() {
	return await api.get({
		url: "/settings/monitoring",
	});
}
