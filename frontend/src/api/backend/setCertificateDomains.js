import * as api from "./base";

/**
 * Change the domain names of a Certbot certificate: it is requested again under the same entry
 *
 * @param {number}   id
 * @param {string[]} domainNames
 */
export async function setCertificateDomains(id, domainNames) {
	return await api.put({
		url: `/nginx/certificates/${id}/domains`,
		data: { domainNames },
	});
}
