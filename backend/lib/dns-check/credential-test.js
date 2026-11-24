import { providerFetch } from "../ddns/provider-fetch.js";
import { listProviderZones, refusalOf } from "../ddns/providers/index.js";

// The credential Test: one page of the zone list and, when the credential has a domain and the provider can read
// records, one A read at the first domain's apex. Reads only, nothing stored, nothing written.

const TEST_DEADLINE_MS = 30_000;

const failed = (error) => {
	switch (error.code) {
		case "blocked":
			return "blocked";
		case "timeout":
		case "network":
			return "unreachable";
		default:
			return "failed";
	}
};

/**
 * @param   {Object}   options
 * @param   {Object}   options.provider  an entry of PROVIDERS with listZones
 * @param   {Object}   options.fields    the credential's fields
 * @param   {String[]} options.secrets   values scrubbed from every message
 * @param   {String[]} [options.domains] the credential's domain names
 * @param   {Function} [options.fetch]   the provider call, (url, options) => answer; providerFetch by default
 * @returns {Promise<{ supported: true, state: String, zones_seen: number, needs: String|null, message: String|null }>}
 *   state: works, wrong-key, missing-right, refused, failed, unreachable or blocked
 */
const testCredential = async ({ provider, fields, secrets, domains = [], fetch = providerFetch }) => {
	const deadline = AbortSignal.timeout(TEST_DEADLINE_MS);
	const call = (url, options) => fetch(url, { ...options, secrets, deadline });
	let zonesSeen = 0;
	try {
		const zones = await listProviderZones(provider, { fields, secrets, maxPages: 1, fetch: call });
		zonesSeen = zones.length;
		const [apex] = domains;
		if (typeof apex === "string" && typeof provider.read === "function" && provider.apex !== false) {
			try {
				await provider.read({ zone: apex, name: apex, type: "A", fields, fetch: call, meta: {} });
			} catch (error) {
				// a zone the provider does not know under this name: the read right is not what failed
				if (!(error?.name === "DdnsProviderError" && error.code === "failed" && error.providerStatus === 404)) {
					throw error;
				}
			}
		}
		return { supported: true, state: "works", zones_seen: zonesSeen, needs: null, message: null };
	} catch (error) {
		if (error?.name !== "DdnsProviderError") throw error;
		let state = failed(error);
		if (error.code === "forbidden") {
			state = refusalOf(provider, error);
			// Cloudflare: the verify call tells a wrong token from a missing right
			if (state === "refused" && typeof provider.verifyRefusal === "function") {
				try {
					state = await provider.verifyRefusal({ fields, fetch: call });
				} catch {
					state = "refused";
				}
			}
		}
		return {
			supported: true,
			state,
			zones_seen: zonesSeen,
			needs: error.code === "forbidden" && error.hint ? error.hint : null,
			message: error.message,
		};
	}
};

export { testCredential };
