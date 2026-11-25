import * as api from "./base";

/**
 * Takes over the record that exists at a host name (Adopt and update)
 *
 * @param {number} id  the Dynamic DNS record row of the host name
 */
export async function adoptHostDnsRecord(id) {
	return await api.post({ url: `/nginx/ddns-records/${id}/adopt` });
}
