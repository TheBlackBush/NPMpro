import * as api from "./base";

export async function getMonitoringSummary() {
	return await api.get({
		url: "/monitoring/summary",
	});
}
