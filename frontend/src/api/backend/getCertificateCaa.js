import * as api from "./base";

/** The cached CAA results of the ACME certificates the user may view (the server refreshes a few old ones) */
export async function getCertificateCaa() {
	return await api.get({ url: "/nginx/certificates/caa" });
}
