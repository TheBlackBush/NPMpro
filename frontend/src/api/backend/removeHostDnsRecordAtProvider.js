import * as api from "./base";

/**
 * Deletes the record of an orphan row at the provider again
 *
 * @param {number} id  the Dynamic DNS record row of the host name
 */
export async function removeHostDnsRecordAtProvider(id) {
	return await api.post({ url: `/nginx/ddns-records/${id}/remove-at-provider` });
}
