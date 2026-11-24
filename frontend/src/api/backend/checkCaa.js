import * as api from "./base";

/**
 * Checks the CAA records of names for the CA that would issue them (1 to 100 names, nothing is stored)
 *
 * @param {{ domainNames: string[], acmeServer?: string, dnsChallenge?: boolean }} request
 */
export async function checkCaa(request) {
	return await api.post({ url: "/nginx/certificates/caa-check", data: request });
}
