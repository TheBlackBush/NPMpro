import * as api from "./base";

export async function updateGeoipNow() {
	return await api.post({
		url: "/settings/geoip/update",
	});
}
