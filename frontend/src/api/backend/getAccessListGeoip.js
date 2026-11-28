import * as api from "./base";

/**
 * Whether the country rules of access lists can be saved and enforced
 *
 * @returns {Promise<{ available: boolean, failsOpen: boolean, provider: string, customDirective: boolean, listsWithRules: number }>}
 */
export async function getAccessListGeoip() {
	return await api.get({
		url: "/nginx/access-lists/geoip",
	});
}
