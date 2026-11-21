import * as api from "./base";

/**
 * @param {number} id
 * @param {string} server  the CA's directory URL, one of getAcmeServers
 */
export async function reissueCertificate(id, server) {
	return await api.post({
		url: `/nginx/certificates/${id}/reissue`,
		data: { npmproAcmeServer: server },
	});
}
