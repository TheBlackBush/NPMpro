import { geoipSettingsPayload } from "src/modules/Monitoring";
import * as api from "./base";

export async function updateGeoipSettings(values) {
	return await api.put({
		url: "/settings/geoip",
		data: geoipSettingsPayload(values),
	});
}
