import * as api from "./base";

/**
 * @param {number} id  the credential id
 * @param {AbortSignal} [signal]  aborts the request (the window was closed)
 */
export async function getProviderDomains(id, signal) {
	return await api.get({ url: `/nginx/dns-credentials/${id}/provider-domains` }, signal ? { signal } : undefined);
}
