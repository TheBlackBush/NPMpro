import { DdnsProviderError } from "../errors.js";
import {
	assertChallengeItem,
	changedSet,
	collectChallenges,
	fullName,
	PREFIX,
	sameValues,
	settleDelete,
	unquote,
} from "./challenge-common.js";
import {
	assertRemovable,
	judgeSet,
	pathName,
	recordGone,
	refuseMultiple,
	refuseWildcard,
	relativeName,
	sameAddress,
	zoneNotFound,
} from "./record-common.js";
import { collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const DEFAULT_ENDPOINT = "https://desec.io/api/v1/";
const HINT = "A token that may read and change the RRsets of the domain";
// the documented common minimum of a domain (its own setting may be higher: the failed answer then says so)
const MIN_TTL = 3600;
const MAX_TTL = 86_400;
const TRAILING_SLASHES = /\/+$/u;

const LIST_HINT = "A token that may read the domains of the account";
const WHITESPACE = /\s+/u;
const LINK_ENTRY = /<(?<url>[^>]*)>(?<params>[^<]*)/gu;
const LINK_REL = /;\s*rel\s*=\s*(?:"(?<quoted>[^"]*)"|(?<bare>[^\s;,]+))/iu;

/**
 * The URL of the Link header entry whose rel holds the given token (exact token, "nextfoo" is not "next").
 *
 * @param   {String} header
 * @param   {String} rel
 * @returns {String|undefined}
 */
const linkOf = (header, rel) => {
	for (const entry of header.matchAll(LINK_ENTRY)) {
		const match = LINK_REL.exec(entry.groups.params);
		const tokens = (match?.groups.quoted ?? match?.groups.bare ?? "").toLowerCase().split(WHITESPACE);
		if (tokens.includes(rel)) return entry.groups.url;
	}
};

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

/**
 * A cursor link of an answer as an absolute URL; one of another origin is never followed: it would send the token
 * elsewhere.
 */
const sameOriginLink = (base, link, res, secrets) => {
	let target;
	try {
		target = new URL(link, base);
	} catch {
		throw malformed(res, secrets);
	}
	if (target.origin !== base.origin) throw malformed(res, secrets);
	return target.href;
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
			// the RRset was deleted between the read and the write: the next check creates it again
			if (res.status === 404) throw recordGone(res, secrets);
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
	// only a 401 is documented (observed); the refusal of a restricted token's write is not
	testRefusal: statusRefusal({ 401: "wrong-key" }),
	/** The TXT RRsets of the domain (a set is one item), cursor paged by the Link header; `touched` is the time */
	listChallenges({ zone, fields, fetch }) {
		const secrets = secretsOf(fields);
		const base = new URL(baseOf(fields.dns_desec_endpoint));
		const root = rrsetsUrl(fields, zone);
		let url = `${root}?type=TXT`;
		return collectChallenges({
			zone,
			fetchPage: async () => {
				const res = await fetch(url, { headers: headersOf(fields) });
				if (res.status === 404) throw zoneNotFound(res, secrets);
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				const next = linkOf(res.headers?.get?.("link") ?? "", "next");
				if (next !== undefined) url = sameOriginLink(base, next, res, secrets);
				return {
					records: res.json.map((rrset) => ({
						name: fullName(zone, rrset?.subname, true),
						type: rrset?.type,
						id: null,
						values: Array.isArray(rrset?.records) ? rrset.records : [],
						changed_on: rrset?.touched ?? rrset?.created,
					})),
					more: next !== undefined,
				};
			},
			cnames: async () => {
				const res = await fetch(`${root}?type=CNAME&subname=${PREFIX}`, { headers: headersOf(fields) });
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return res.json.filter((rrset) => rrset?.type === "CNAME").length;
			},
		});
	},
	/** Deletes the whole RRset, but only when it still holds exactly the values the list showed; 204 also when gone */
	async removeChallenge({ zone, item, fields, fetch }) {
		assertChallengeItem(zone, item);
		const secrets = secretsOf(fields);
		const url = `${rrsetsUrl(fields, zone)}${pathName(zone, item.name)}/TXT/`;
		// null: the RRset is not there; a 404 may also be a missing domain, which the domain's own list tells (a failure)
		const read = async () => {
			const res = await fetch(url, { headers: headersOf(fields) });
			if (res.status === 404) {
				const zoneRes = await fetch(
					`${rrsetsUrl(fields, zone)}?type=TXT&subname=${encodeURIComponent(PREFIX)}`,
					{
						headers: headersOf(fields),
					},
				);
				if (zoneRes.status === 404) throw zoneNotFound(zoneRes, secrets);
				if (zoneRes.status !== 200) failAnswer(zoneRes, { hint: HINT, secrets });
				return null;
			}
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			if (!Array.isArray(res.json?.records)) throw malformed(res, secrets);
			return res.json.records;
		};
		const current = await read();
		if (current === null) return { gone: true };
		if (!sameValues(current.map(unquote), item.values)) return changedSet();
		const res = await fetch(url, { method: "DELETE", headers: headersOf(fields) });
		return settleDelete({
			res,
			ok: (answer) => answer.status === 204,
			recheck: async () => (await read()) === null,
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets }),
		});
	},
	/**
	 * Deletes the A or AAAA RRset NPMpro wrote, but only when it holds nothing but `value`; deSEC answers 204 for a
	 * delete of a set that is gone too
	 */
	async remove({ zone, name, type, value, fields, fetch }) {
		const wanted = assertRemovable({ zone, name, type, value });
		refuseWildcard(wanted);
		const secrets = secretsOf(fields);
		const url = `${rrsetsUrl(fields, zone)}${pathName(zone, wanted)}/${type}/`;
		// a 404 on the RRset may also be a missing domain, which the domain's own list tells (a failure)
		const read = async () => {
			const res = await fetch(url, { headers: headersOf(fields) });
			if (res.status === 404) {
				const zoneRes = await fetch(
					`${rrsetsUrl(fields, zone)}?type=TXT&subname=${encodeURIComponent(PREFIX)}`,
					{ headers: headersOf(fields) },
				);
				if (zoneRes.status === 404) throw zoneNotFound(zoneRes, secrets);
				if (zoneRes.status !== 200) failAnswer(zoneRes, { hint: HINT, secrets });
				return [];
			}
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			if (!Array.isArray(res.json?.records)) throw malformed(res, secrets);
			return res.json.records;
		};
		const verdict = judgeSet(await read(), value);
		if (verdict === "gone") return { gone: true };
		if (verdict === "changed") return changedSet();
		const res = await fetch(url, { method: "DELETE", headers: headersOf(fields) });
		return settleDelete({
			res,
			ok: (answer) => answer.status === 204,
			recheck: async () => !(await read()).some((entry) => sameAddress(entry, value)),
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets }),
		});
	},
	/**
	 * The domains, newest first. The Link header cursor (rel="next") is followed; a 400 that carries a rel="first"
	 * link (more than 500 domains need a cursor) is followed once. Links of another origin are never followed: they
	 * would send the token elsewhere.
	 */
	listZones: ({ fields, fetch, maxPages }) => {
		let base = null;
		let url = null;
		let firstTried = false;
		const follow = (link, res, secrets) => sameOriginLink(base, link, res, secrets);
		return collectZones({
			maxPages,
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				if (base === null) {
					base = new URL(baseOf(fields.dns_desec_endpoint));
					url = `${base.href}domains/`;
				}
				let res = await fetch(url, { headers: headersOf(fields) });
				const first =
					res.status === 400 && !firstTried ? linkOf(res.headers?.get?.("link") ?? "", "first") : undefined;
				if (first !== undefined) {
					firstTried = true;
					url = follow(first, res, secrets);
					res = await fetch(url, { headers: headersOf(fields) });
				}
				if (res.status !== 200) failAnswer(res, { hint: LIST_HINT, secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				const next = linkOf(res.headers?.get?.("link") ?? "", "next");
				if (next !== undefined) url = follow(next, res, secrets);
				return { names: res.json.map((zone) => zone?.name), more: next !== undefined };
			},
		});
	},
};
