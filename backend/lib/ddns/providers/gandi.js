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
	dotted,
	jsonHeaders,
	judgeSet,
	pathName,
	plainTarget,
	refuseMultiple,
	refuseWildcard,
	sameAddress,
	zoneNotFound,
} from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const PER_PAGE = 100;
const HINT = "Manage domain technical configurations";
const MIN_TTL = 300;
const MAX_TTL = 2_592_000;
const secretsOf = (fields) => [fields.dns_gandi_token];
const recordsUrl = (zone) => `https://api.gandi.net/v5/livedns/domains/${encodeURIComponent(zone)}/records`;
const rrsetUrl = (zone, name, type) =>
	`https://api.gandi.net/v5/livedns/domains/${encodeURIComponent(zone)}/records/${pathName(zone, name)}/${type}`;

export default {
	id: "gandi",
	label: "Gandi",
	credentialProvider: "gandi",
	recordTypes: ["A", "AAAA", "CNAME"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	wildcards: false,
	aliases: true,
	// rrset_ttl from 300 (Gandi LiveDNS API)
	minTtl: 300,
	async read({ zone, name, type, fields, fetch, meta }) {
		refuseWildcard(name);
		const res = await fetch(rrsetUrl(zone, name, type), { headers: bearer(fields.dns_gandi_token) });
		if (res.status === 404) return null;
		if (res.status !== 200) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
		if (!Array.isArray(res.json?.rrset_values)) throw malformed(res, secretsOf(fields));
		const values = type === "CNAME" ? res.json.rrset_values.map(plainTarget) : res.json.rrset_values;
		return { values, ttl: typeof res.json.rrset_ttl === "number" ? res.json.rrset_ttl : null, meta: { ...meta } };
	},
	/** One PUT creates or overwrites the rrset; the ttl is kept (or 300) when none is set */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseWildcard(name);
		refuseMultiple(existing);
		// a ttl the user set is checked; the existing one is kept as the provider has it
		const rrsetTtl = ttl ?? existing?.ttl ?? MIN_TTL;
		if (ttl !== undefined && ttl !== null && (!Number.isInteger(ttl) || ttl < MIN_TTL || ttl > MAX_TTL)) {
			throw new DdnsProviderError({
				code: "failed",
				message: `Gandi needs a TTL between ${MIN_TTL} and ${MAX_TTL} seconds`,
				retry: false,
			});
		}
		const res = await fetch(rrsetUrl(zone, name, type), {
			method: "PUT",
			headers: jsonHeaders(bearer(fields.dns_gandi_token)),
			body: JSON.stringify({ rrset_values: [type === "CNAME" ? dotted(ip) : ip], rrset_ttl: rrsetTtl }),
		});
		if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
		if (![200, 201].includes(res.status)) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
		return { meta: { ...meta }, created: !existing };
	},
	// a wrong token answers 403 like a missing right (observed), so only a 401 is told apart
	testRefusal: statusRefusal({ 401: "wrong-key" }),
	/** The TXT RRsets of the zone (a set is one item); no RRset has a time */
	listChallenges({ zone, fields, fetch }) {
		const headers = bearer(fields.dns_gandi_token);
		return collectChallenges({
			zone,
			fetchPage: async (page) => {
				const res = await fetch(`${recordsUrl(zone)}?rrset_type=TXT&page=${page}&per_page=${PER_PAGE}`, {
					headers,
				});
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
				if (!Array.isArray(res.json)) throw malformed(res, secretsOf(fields));
				return {
					records: res.json.map((rrset) => ({
						name: fullName(zone, rrset?.rrset_name, true),
						type: rrset?.rrset_type,
						id: null,
						values: Array.isArray(rrset?.rrset_values) ? rrset.rrset_values : [],
					})),
					more: res.json.length >= PER_PAGE,
				};
			},
			// one RRset lookup; a missing one is a 404
			cnames: async () => {
				const res = await fetch(`${recordsUrl(zone)}/${PREFIX}/CNAME`, { headers });
				if (res.status === 404) return 0;
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
				return 1;
			},
		});
	},
	/** Deletes the whole RRset, but only when it still holds exactly the values the list showed */
	async removeChallenge({ zone, item, fields, fetch }) {
		assertChallengeItem(zone, item);
		const headers = bearer(fields.dns_gandi_token);
		const url = rrsetUrl(zone, item.name, "TXT");
		// a 404 on the set may also be a missing zone: the zone's own list tells, and a missing zone is a failure
		const read = async () => {
			const res = await fetch(url, { headers });
			if (res.status === 404) {
				const zoneRes = await fetch(`${recordsUrl(zone)}?rrset_type=TXT&per_page=1`, { headers });
				if (zoneRes.status === 404) throw zoneNotFound(zoneRes, secretsOf(fields));
				if (zoneRes.status !== 200) failAnswer(zoneRes, { hint: HINT, secrets: secretsOf(fields) });
				return null;
			}
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
			if (!Array.isArray(res.json?.rrset_values)) throw malformed(res, secretsOf(fields));
			return res.json.rrset_values;
		};
		const current = await read();
		if (current === null) return { gone: true };
		if (!sameValues(current.map(unquote), item.values)) return changedSet();
		const res = await fetch(url, { method: "DELETE", headers });
		return settleDelete({
			res,
			ok: (answer) => answer.status === 204 || answer.status === 200,
			recheck: async () => (await read()) === null,
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets: secretsOf(fields) }),
		});
	},
	/**
	 * Deletes the A or AAAA RRset NPMpro wrote, but only when it holds nothing but `value`. Gandi's gone answer for a
	 * delete is not documented: a failed delete is read again and an absent set is done.
	 */
	async remove({ zone, name, type, value, fields, fetch }) {
		const wanted = assertRemovable({ zone, name, type, value });
		refuseWildcard(wanted);
		const headers = bearer(fields.dns_gandi_token);
		const url = rrsetUrl(zone, wanted, type);
		// a 404 on the set may also be a missing zone: the zone's own list tells, and a missing zone is a failure
		const read = async () => {
			const res = await fetch(url, { headers });
			if (res.status === 404) {
				const zoneRes = await fetch(`${recordsUrl(zone)}?rrset_type=TXT&per_page=1`, { headers });
				if (zoneRes.status === 404) throw zoneNotFound(zoneRes, secretsOf(fields));
				if (zoneRes.status !== 200) failAnswer(zoneRes, { hint: HINT, secrets: secretsOf(fields) });
				return [];
			}
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
			if (!Array.isArray(res.json?.rrset_values)) throw malformed(res, secretsOf(fields));
			return res.json.rrset_values;
		};
		const verdict = judgeSet(await read(), value);
		if (verdict === "gone") return { gone: true };
		if (verdict === "changed") return changedSet();
		const res = await fetch(url, { method: "DELETE", headers });
		return settleDelete({
			res,
			ok: (answer) => answer.status === 204 || answer.status === 200,
			recheck: async () => !(await read()).some((entry) => sameAddress(entry, value)),
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets: secretsOf(fields) }),
		});
	},
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async (page) => {
				const secrets = [fields.dns_gandi_token];
				const res = await fetch(`https://api.gandi.net/v5/livedns/domains?page=${page}&per_page=${PER_PAGE}`, {
					headers: bearer(fields.dns_gandi_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "Manage domain technical configurations", secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return { names: res.json.map((domain) => domain?.fqdn), more: res.json.length >= PER_PAGE };
			},
		}),
};
