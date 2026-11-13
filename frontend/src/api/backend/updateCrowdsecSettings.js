import * as api from "./base";

export async function updateCrowdsecSettings(data) {
	return await api.put({ url: "/settings/crowdsec", data });
}
