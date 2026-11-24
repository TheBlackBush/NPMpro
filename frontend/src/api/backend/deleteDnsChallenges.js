import * as api from "./base";

/**
 * Deletes the chosen leftover challenge records; the answer has one result per item
 *
 * @param {number} id  the credential id
 * @param {Array<{ name: string, id: string|null, values: string[] }>} items  the records as the list showed them
 */
export async function deleteDnsChallenges(id, items) {
	return await api.post({ url: `/nginx/dns-credentials/${id}/challenges/delete`, data: { items } });
}
