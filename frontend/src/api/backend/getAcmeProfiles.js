import * as api from "./base";

/**
 * @param {string}  [server]  default the instance CA
 * @param {Object}  [options]
 * @param {boolean} [options.fresh]  read the CA's directory now, not from the backend's five minute cache
 */
export async function getAcmeProfiles(server, { fresh = false } = {}) {
	return await api.get({
		url: "/settings/acme/profiles",
		params: { ...(server ? { server } : {}), ...(fresh ? { fresh: true } : {}) },
	});
}
