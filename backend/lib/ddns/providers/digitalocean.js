import { DdnsProviderError } from "../errors.js";
import { dotted, jsonHeaders, plainTarget, refuseMultiple, relativeName, zoneNotFound } from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

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
	listZones: ({ fields, fetch }) =>
		collectZones({
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
