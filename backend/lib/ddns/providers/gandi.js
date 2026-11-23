import { DdnsProviderError } from "../errors.js";
import {
	dotted,
	jsonHeaders,
	pathName,
	plainTarget,
	refuseMultiple,
	refuseWildcard,
	zoneNotFound,
} from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const PER_PAGE = 100;
const HINT = "Manage domain technical configurations";
const MIN_TTL = 300;
const MAX_TTL = 2_592_000;
const secretsOf = (fields) => [fields.dns_gandi_token];
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
	listZones: ({ fields, fetch }) =>
		collectZones({
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
