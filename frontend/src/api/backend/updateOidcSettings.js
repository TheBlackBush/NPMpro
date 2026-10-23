import { oidcSettingsPayload } from "src/modules/Oidc";
import * as api from "./base";

export async function updateOidcSettings(values) {
	return await api.put({
		url: "/settings/oidc",
		data: oidcSettingsPayload(values),
	});
}
