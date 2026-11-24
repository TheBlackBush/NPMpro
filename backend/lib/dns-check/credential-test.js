import { providerFetch } from "../ddns/provider-fetch.js";
import { listProviderZones, refusalOf } from "../ddns/providers/index.js";

// The credential Test: one page of the zone list and, when a domain of the credential is a zone on that page and the
// provider can read records, one A read at that zone's apex. Reads only, nothing stored, nothing written.

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
		// the first domain that is a zone the page listed: a domain below a zone, or one the page did not show, is not
		// read (its zone call would fail for a token that works)
		const listed = new Set(zones);
		const apex = domains.find((domain) => typeof domain === "string" && listed.has(domain.toLowerCase()));
		if (apex !== undefined && typeof provider.read === "function" && provider.apex !== false) {
			const zone = apex.toLowerCase();
			await provider.read({ zone, name: zone, type: "A", fields, fetch: call, meta: {} });
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
				} catch (verifyError) {
					if (verifyError?.name !== "DdnsProviderError") throw verifyError;
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
