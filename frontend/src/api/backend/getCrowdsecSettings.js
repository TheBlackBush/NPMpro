import * as api from "./base";

export async function getCrowdsecSettings() {
	return await api.get({ url: "/settings/crowdsec" });
}
