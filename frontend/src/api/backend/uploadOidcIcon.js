import { OIDC_ICON_MAX_BYTES } from "src/modules/Oidc";
import * as api from "./base";

export async function uploadOidcIcon(file) {
	if (file.size > OIDC_ICON_MAX_BYTES) throw new Error("error.oidc-icon-too-large");
	const data = new FormData();
	data.append("file", file);
	return await api.post({
		url: "/settings/oidc/icon",
		data,
	});
}
