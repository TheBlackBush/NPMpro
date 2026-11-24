import { DdnsProviderError } from "../errors.js";
import { pathName, refuseMultiple, refuseWildcard, relativeName, zoneNotFound } from "./record-common.js";
import { failAnswer, malformed } from "./zone-common.js";

const DEFAULT_ENDPOINT = "https://desec.io/api/v1/";
const HINT = "A token that may read and change the RRsets of the domain";
// the documented common minimum of a domain (its own setting may be higher: the failed answer then says so)
const MIN_TTL = 3600;
const MAX_TTL = 86_400;
const TRAILING_SLASHES = /\/+$/u;

const secretsOf = (fields) => [fields.dns_desec_token].filter((value) => typeof value === "string" && value !== "");

/**
 * The API base: https only, origin and path only (no userinfo, query or hash), one trailing slash. The outbound
 * guard checks the host on every call.
 *
 * @param   {*} value  the optional endpoint of the credential
 * @returns {String}
 */
const baseOf = (value) => {
	const text = typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_ENDPOINT;
	let url;
	try {
		url = new URL(text);
	} catch {
		throw new DdnsProviderError({ code: "not-https", message: "The deSEC endpoint is not a URL", retry: false });
	}
	if (url.protocol !== "https:") {
		throw new DdnsProviderError({
			code: "not-https",
			message: "The deSEC endpoint must be an https URL",
			retry: false,
		});
	}
	return `${url.origin}${url.pathname.replace(TRAILING_SLASHES, "")}/`;
};

const headersOf = (fields, json = false) => ({
	Authorization: `Token ${fields.dns_desec_token}`,
	Accept: "application/json",
	...(json ? { "Content-Type": "application/json" } : {}),
});

const rrsetsUrl = (fields, zone) => `${baseOf(fields.dns_desec_endpoint)}domains/${encodeURIComponent(zone)}/rrsets/`;

const checkTtl = (ttl) => {
	if (ttl === undefined || ttl === null) return;
	if (!Number.isInteger(ttl) || ttl < MIN_TTL || ttl > MAX_TTL) {
		throw new DdnsProviderError({
			code: "failed",
			message: `deSEC needs a TTL between ${MIN_TTL} and ${MAX_TTL} seconds`,
			retry: false,
		});
	}
};

export default {
	id: "desec",
	label: "deSEC",
	credentialProvider: "desec",
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	// the wildcard form and the CNAME rules are documented by deSEC, but the project refuses both for every
	// provider added in PR 6 until a live check confirms them
	wildcards: false,
	aliases: false,
	minTtl: MIN_TTL,
	async read({ zone, name, type, fields, fetch, meta }) {
		refuseWildcard(name);
		const secrets = secretsOf(fields);
		const res = await fetch(`${rrsetsUrl(fields, zone)}${pathName(zone, name)}/${type}/`, {
			headers: headersOf(fields),
		});
		// a missing RRset, and also a domain of another account
		if (res.status === 404) return null;
		if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
		if (!Array.isArray(res.json?.records) || !res.json.records.every((value) => typeof value === "string")) {
			throw malformed(res, secrets);
		}
		return {
			values: res.json.records,
			ttl: Number.isInteger(res.json.ttl) && res.json.ttl > 0 ? res.json.ttl : null,
			meta: { ...meta },
		};
	},
	/** PATCH changes an existing RRset (never an empty records list, which deletes it); POST creates a missing one */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseWildcard(name);
		refuseMultiple(existing);
		checkTtl(ttl);
		const secrets = secretsOf(fields);
		const url = rrsetsUrl(fields, zone);
		if (existing) {
			const res = await fetch(`${url}${pathName(zone, name)}/${type}/`, {
				method: "PATCH",
				headers: headersOf(fields, true),
				body: JSON.stringify({ records: [ip], ...(ttl === undefined || ttl === null ? {} : { ttl }) }),
			});
			if (res.status === 404) throw zoneNotFound(res, secrets);
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			return { meta: { ...meta }, created: false };
		}
		const sub = relativeName(zone, name);
		const res = await fetch(url, {
			method: "POST",
			headers: headersOf(fields, true),
			body: JSON.stringify({
				...(sub === "@" ? {} : { subname: sub }),
				type,
				records: [ip],
				ttl: ttl ?? MIN_TTL,
			}),
		});
		if (res.status === 404) throw zoneNotFound(res, secrets);
		if (res.status !== 201 && res.status !== 200) failAnswer(res, { hint: HINT, secrets });
		return { meta: { ...meta }, created: true };
	},
};
