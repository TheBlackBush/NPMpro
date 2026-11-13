import * as api from "./base";

export async function testCrowdsecSettings(data) {
	return await api.post({ url: "/settings/crowdsec/test", data });
}
