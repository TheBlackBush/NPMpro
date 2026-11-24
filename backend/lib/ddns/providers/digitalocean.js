import { DdnsProviderError } from "../errors.js";
import { assertChallengeItem, collectChallenges, fullName, PREFIX, settleDelete } from "./challenge-common.js";
import { dotted, jsonHeaders, plainTarget, refuseMultiple, relativeName, zoneNotFound } from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed, statusRefusal } from "./zone-common.js";

const HINT = "domain:read and domain:update";
const secretsOf = (fields) => [fields.dns_digitalocean_token];
const recordsUrl = (zone) => `https://api.digitalocean.com/v2/domains/${encodeURIComponent(zone)}/records`;

const check = (res, fields, okStatuses = [200]) => {
	if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
	if (!okStatuses.includes(res.status)) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
};

/** A CNAME data value: `@` is the zone, a value with a dot is absolute (no trailing dot), one label is relative */
const cnameValue = (zone, data) => {
	const text = plainTarget(data);
	if (text === "@") return zone.toLowerCase();
	return text.includes(".") ? text : `${text}.${zone.toLowerCase()}`;
};

export default {
	id: "digitalocean",
	label: "DigitalOcean",
	credentialProvider: "digitalocean",
	recordTypes: ["A", "AAAA", "CNAME"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	wildcards: true,
	aliases: true,
	// "All DNS records require a minimum TTL value of 30 seconds" (DigitalOcean DNS limits)
	minTtl: 30,
	/** The list filter takes the full name, also for a wildcard (`*.<zone>`) */
	async read({ zone, name, type, fields, fetch, meta }) {
		const res = await fetch(`${recordsUrl(zone)}?type=${type}&name=${encodeURIComponent(name)}`, {
			headers: bearer(fields.dns_digitalocean_token),
		});
		check(res, fields);
		if (!Array.isArray(res.json?.domain_records)) throw malformed(res, secretsOf(fields));
		const records = res.json.domain_records.filter((record) => record?.type === type);
		if (records.length === 0) return null;
		const [first] = records;
		return {
			values: records.map((record) => (type === "CNAME" ? cnameValue(zone, record?.data) : record?.data)),
			ttl: typeof first?.ttl === "number" ? first.ttl : null,
			meta: { ...meta, record_id: first?.id ?? null },
		};
	},
	/** PATCH { data } (and ttl when set); a create posts the relative name (`@` apex, `*` wildcard) */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseMultiple(existing);
		const data = type === "CNAME" ? dotted(ip) : ip;
		const headers = jsonHeaders(bearer(fields.dns_digitalocean_token));
		if (existing) {
			const recordId = meta?.record_id ?? existing.meta?.record_id;
			const res = await fetch(`${recordsUrl(zone)}/${recordId}`, {
				method: "PATCH",
				headers,
				body: JSON.stringify(ttl ? { data, ttl } : { data }),
			});
			if (res.status === 404) {
				throw new DdnsProviderError({
					providerStatus: 404,
					code: "failed",
					message: "The record was removed at the provider; it is created again on the next check",
					secrets: secretsOf(fields),
				});
			}
			check(res, fields);
			return { meta: { ...meta, record_id: recordId }, created: false };
		}
		const body = { type, name: relativeName(zone, name), data };
		if (ttl) body.ttl = ttl;
		const res = await fetch(recordsUrl(zone), { method: "POST", headers, body: JSON.stringify(body) });
		check(res, fields, [200, 201]);
		return { meta: { ...meta, record_id: res.json?.domain_record?.id ?? null }, created: true };
	},
	testRefusal: statusRefusal({ 401: "wrong-key", 403: "missing-right" }),
	/** The TXT records of the zone (the name filter is exact, so the prefix is filtered here); no record has a time */
	listChallenges({ zone, fields, fetch }) {
		const headers = bearer(fields.dns_digitalocean_token);
		return collectChallenges({
			zone,
			fetchPage: async (page) => {
				const res = await fetch(`${recordsUrl(zone)}?type=TXT&page=${page}&per_page=200`, { headers });
				check(res, fields);
				if (!Array.isArray(res.json?.domain_records)) throw malformed(res, secretsOf(fields));
				return {
					records: res.json.domain_records.map((record) => ({
						name: fullName(zone, record?.name, true),
						type: record?.type,
						id: record?.id,
						values: [record?.data],
					})),
					more: Boolean(res.json.links?.pages?.next),
				};
			},
			// the TXT list cannot show a CNAME: one exact lookup of the challenge name
			cnames: async () => {
				const res = await fetch(
					`${recordsUrl(zone)}?type=CNAME&name=${PREFIX}.${encodeURIComponent(zone.toLowerCase())}`,
					{
						headers,
					},
				);
				check(res, fields);
				if (!Array.isArray(res.json?.domain_records)) throw malformed(res, secretsOf(fields));
				return res.json.domain_records.filter((record) => record?.type === "CNAME").length;
			},
		});
	},
	/** DELETE by id: 204; 404 is the documented "not found" */
	async removeChallenge({ zone, item, fields, fetch }) {
		assertChallengeItem(zone, item);
		const res = await fetch(`${recordsUrl(zone)}/${encodeURIComponent(item.id)}`, {
			method: "DELETE",
			headers: bearer(fields.dns_digitalocean_token),
		});
		return settleDelete({
			res,
			ok: (answer) => answer.status === 204 || answer.status === 200,
			gone: (answer) => answer.status === 404,
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets: secretsOf(fields) }),
		});
	},
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async (page) => {
				const secrets = [fields.dns_digitalocean_token];
				const res = await fetch(`https://api.digitalocean.com/v2/domains?page=${page}&per_page=200`, {
					headers: bearer(fields.dns_digitalocean_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "domain:read", secrets });
				if (!Array.isArray(res.json?.domains)) throw malformed(res, secrets);
				return {
					names: res.json.domains.map((domain) => domain?.name),
					more: Boolean(res.json.links?.pages?.next),
				};
			},
		}),
};
