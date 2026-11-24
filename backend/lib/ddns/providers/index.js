import { DdnsProviderError } from "../errors.js";
import { providerFetch } from "../provider-fetch.js";
import bunny from "./bunny.js";
import cloudflare from "./cloudflare.js";
import custom from "./custom.js";
import desec from "./desec.js";
import digitalocean from "./digitalocean.js";
import duckdns from "./duckdns.js";
import dynu from "./dynu.js";
import gandi from "./gandi.js";
import godaddy from "./godaddy.js";
import hetznerCloud from "./hetzner-cloud.js";
import ionos from "./ionos.js";
import linode from "./linode.js";
import namecheap from "./namecheap.js";
import noip from "./noip.js";
import ovh from "./ovh.js";
import porkbun from "./porkbun.js";
import powerdns from "./powerdns.js";
import vultr from "./vultr.js";

/** The providers with an API, in the order the UI shows them */
const PROVIDERS = Object.freeze([
	cloudflare,
	digitalocean,
	hetznerCloud,
	gandi,
	ovh,
	desec,
	duckdns,
	porkbun,
	namecheap,
	noip,
	dynu,
	custom,
	powerdns,
	linode,
	vultr,
	bunny,
	ionos,
	godaddy,
]);

const providerById = (id) => PROVIDERS.find((provider) => provider.id === id) ?? null;

// the custom provider has no credential: no credential provider is its
const providerForCredential = (credentialProvider) =>
	typeof credentialProvider === "string"
		? (PROVIDERS.find((provider) => provider.credentialProvider === credentialProvider) ?? null)
		: null;

/** A provider without listZones (Namecheap, No-IP) updates records but has no zone fetch */
const zoneLister = (credentialProvider) => {
	const provider = providerForCredential(credentialProvider);
	return typeof provider?.listZones === "function" ? provider : null;
};

const listsDomains = (credentialProvider) => zoneLister(credentialProvider) !== null;

/** The providers that can read and write records (PowerDNS, Linode, Vultr, bunny.net, IONOS and GoDaddy only list zones) */
const updaterFor = (credentialProvider) => {
	const provider = providerForCredential(credentialProvider);
	return typeof provider?.read === "function" && typeof provider?.write === "function" ? provider : null;
};

/** A provider that can list and delete its `_acme-challenge` TXT records (the cleanup) */
const cleansChallenges = (credentialProvider) => {
	const provider = providerForCredential(credentialProvider);
	return typeof provider?.listChallenges === "function" && typeof provider?.removeChallenge === "function";
};

/**
 * How a refused call of the credential Test reads: "wrong-key", "missing-right" or "refused" (the provider cannot
 * tell the two apart, or the status is not mapped)
 *
 * @param   {Object|String} provider  an entry of PROVIDERS or a credential provider
 * @param   {Error}         err       the error of the refused call (providerStatus)
 * @returns {"wrong-key"|"missing-right"|"refused"}
 */
const refusalOf = (provider, err) => {
	const entry = typeof provider === "string" ? providerForCredential(provider) : provider;
	return typeof entry?.testRefusal === "function" ? entry.testRefusal(err) : "refused";
};

/** The updater providers as GET /nginx/ddns/providers shows them */
const PROVIDER_LIST = Object.freeze(
	PROVIDERS.filter((provider) => typeof provider.read === "function" && typeof provider.write === "function").map(
		(provider) => ({
			id: provider.id,
			label: provider.label,
			credential_provider: provider.credentialProvider,
			record_types: provider.recordTypes,
			proxied: provider.proxied,
			ipv6: provider.ipv6,
			ipv6_alone: provider.ipv6Alone !== false,
			admin_only: provider.adminOnly,
			wildcards: provider.wildcards,
			aliases: provider.aliases === true,
			zoneless: provider.zoneless === true,
			preset: provider.preset === true,
			zone: provider.zone ?? null,
			apex: provider.apex !== false,
			min_ttl: provider.minTtl ?? null,
		}),
	),
);

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
 * @param   {number}   [options.maxPages]    stop after this many page calls (the credential Test reads one)
 * @returns {Promise<String[]>}  with truncated: true when the list was cut
 */
const listProviderZones = async (provider, { fields, secrets, deadlineMs = ZONE_LIST_DEADLINE_MS, maxPages }) => {
	const deadline = AbortSignal.timeout(deadlineMs);
	try {
		return await provider.listZones({
			fields,
			maxPages,
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

export {
	cleansChallenges,
	listProviderZones,
	listsDomains,
	PROVIDER_LIST,
	PROVIDERS,
	providerById,
	providerForCredential,
	refusalOf,
	updaterFor,
	ZONE_LIST_DEADLINE_MS,
	zoneLister,
};
