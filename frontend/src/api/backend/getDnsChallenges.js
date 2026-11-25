import * as api from "./base";

/**
 * The leftover ACME challenge TXT records of a DNS credential (read at the provider, nothing is changed)
 *
 * @param {number} id  the credential id
 */
export async function getDnsChallenges(id) {
	return await api.get({ url: `/nginx/dns-credentials/${id}/challenges` });
}
