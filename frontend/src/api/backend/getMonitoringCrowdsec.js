import * as api from "./base";

export async function getMonitoringCrowdsec() {
	return await api.get({
		url: "/monitoring/crowdsec",
	});
}
