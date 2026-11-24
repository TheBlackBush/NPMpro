import * as api from "./base";

/**
 * Reads once through a saved DNS credential; nothing is stored
 *
 * @param {number} id  the credential id
 */
export async function testDnsCredential(id) {
	return await api.post({ url: `/nginx/dns-credentials/${id}/test` });
}
