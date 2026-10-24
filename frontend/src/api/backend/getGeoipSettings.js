import * as api from "./base";

export async function getGeoipSettings() {
	return await api.get({
		url: "/settings/geoip",
	});
}
