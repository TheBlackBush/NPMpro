import { DdnsProviderError } from "../errors.js";
import { providerFetch } from "../provider-fetch.js";
import cloudflare from "./cloudflare.js";
import digitalocean from "./digitalocean.js";
import gandi from "./gandi.js";
import hetznerCloud from "./hetzner-cloud.js";
import ovh from "./ovh.js";
import powerdns from "./powerdns.js";

/** The providers with an API, in the order the UI shows them */
const PROVIDERS = Object.freeze([cloudflare, digitalocean, hetznerCloud, gandi, ovh, powerdns]);

const providerById = (id) => PROVIDERS.find((provider) => provider.id === id) ?? null;

const providerForCredential = (credentialProvider) =>
	PROVIDERS.find((provider) => provider.credentialProvider === credentialProvider) ?? null;

const listsDomains = (credentialProvider) => providerForCredential(credentialProvider) !== null;

/** One zone list, all its pages included, ends after this long */
const ZONE_LIST_DEADLINE_MS = 60_000;

/**
 * The zone list of a provider: every call goes through providerFetch with the credential's secrets, and one deadline
 * covers all of them (each call also has its own timeout).
 *
 * @param   {Object}   provider  an entry of PROVIDERS
 * @param   {Object}   options
 * @param   {Object}   options.fields      the credential's fields
 * @param   {String[]} options.secrets     values scrubbed from every message
 * @param   {number}   [options.deadlineMs]
 * @returns {Promise<String[]>}  with truncated: true when the list was cut
 */
const listProviderZones = async (provider, { fields, secrets, deadlineMs = ZONE_LIST_DEADLINE_MS }) => {
	const deadline = AbortSignal.timeout(deadlineMs);
	try {
		return await provider.listZones({
			fields,
			fetch: (url, options) => providerFetch(url, { ...options, secrets, deadline }),
		});
	} catch (err) {
		if (deadline.aborted && err?.name === "DdnsProviderError" && err.code === "timeout") {
			throw new DdnsProviderError({
				code: "timeout",
				message: `The zone list did not finish within ${deadlineMs / 1000} s and was stopped`,
				secrets,
			});
		}
		throw err;
	}
};

export { listProviderZones, listsDomains, PROVIDERS, providerById, providerForCredential, ZONE_LIST_DEADLINE_MS };
