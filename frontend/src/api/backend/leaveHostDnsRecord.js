import * as api from "./base";

/**
 * Leaves the record that exists at a host name alone and unticks the name
 *
 * @param {number} id  the Dynamic DNS record row of the host name
 */
export async function leaveHostDnsRecord(id) {
	return await api.post({ url: `/nginx/ddns-records/${id}/leave` });
}
