import * as api from "./base";

export async function getAcmeServers() {
	return await api.get({ url: "/nginx/certificates/acme-servers" });
}
