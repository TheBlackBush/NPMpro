import { monitoringSettingsPayload } from "src/modules/Monitoring";
import * as api from "./base";

export async function updateMonitoringSettings(values) {
	return await api.put({
		url: "/settings/monitoring",
		data: monitoringSettingsPayload(values),
	});
}
