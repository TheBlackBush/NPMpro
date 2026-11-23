import {
	dotted,
	jsonHeaders,
	pathName,
	plainTarget,
	refuseMultiple,
	refuseWildcard,
	relativeName,
	zoneNotFound,
} from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const HINT = "Read and write access to the project's DNS zones";
const API = "https://api.hetzner.cloud/v1/zones";
const secretsOf = (fields) => [fields.dns_hetzner_cloud_api_token];
const rrsetUrl = (zone, name, type) => `${API}/${encodeURIComponent(zone)}/rrsets/${pathName(zone, name)}/${type}`;

const check = (res, fields, okStatuses = [200]) => {
	if (!okStatuses.includes(res.status)) failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
};

/** @returns {Promise<{ records: String[], ttl: number|null }|null>}  null when the rrset does not exist (404) */
const getRrset = async ({ zone, name, type, fields, fetch }) => {
	const res = await fetch(rrsetUrl(zone, name, type), { headers: bearer(fields.dns_hetzner_cloud_api_token) });
	if (res.status === 404) return null;
	check(res, fields);
	const rrset = res.json?.rrset;
	if (!Array.isArray(rrset?.records)) throw malformed(res, secretsOf(fields));
	return {
		records: rrset.records.map((record) => record?.value),
		ttl: typeof rrset.ttl === "number" ? rrset.ttl : null,
	};
};

export default {
	id: "hetzner-cloud",
	label: "Hetzner Cloud",
	credentialProvider: "hetzner-cloud",
	recordTypes: ["A", "AAAA", "CNAME"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	wildcards: false,
	async read({ zone, name, type, fields, fetch, meta }) {
		refuseWildcard(name);
		const rrset = await getRrset({ zone, name, type, fields, fetch });
		if (!rrset) return null;
		const values = type === "CNAME" ? rrset.records.map(plainTarget) : rrset.records;
		return { values, ttl: rrset.ttl, meta: { ...meta } };
	},
	/** set_records may reset the ttl: re-read it and set the wanted (or the old) one with change_ttl when it differs */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseWildcard(name);
		refuseMultiple(existing);
		const value = type === "CNAME" ? dotted(ip) : ip;
		const headers = jsonHeaders(bearer(fields.dns_hetzner_cloud_api_token));
		if (!existing) {
			const body = { name: relativeName(zone, name), type, records: [{ value }] };
			if (ttl) body.ttl = ttl;
			const res = await fetch(`${API}/${encodeURIComponent(zone)}/rrsets`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
			check(res, fields, [200, 201]);
			return { meta: { ...meta }, created: true };
		}
		const base = rrsetUrl(zone, name, type);
		const res = await fetch(`${base}/actions/set_records`, {
			method: "POST",
			headers,
			body: JSON.stringify({ records: [{ value }] }),
		});
		if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
		check(res, fields, [200, 201]);
		const wanted = ttl ?? existing.ttl ?? null;
		if (wanted !== null) {
			const after = await getRrset({ zone, name, type, fields, fetch });
			if (after && after.ttl !== wanted) {
				const changed = await fetch(`${base}/actions/change_ttl`, {
					method: "POST",
					headers,
					body: JSON.stringify({ ttl: wanted }),
				});
				check(changed, fields, [200, 201]);
			}
		}
		return { meta: { ...meta }, created: false };
	},
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const secrets = [fields.dns_hetzner_cloud_api_token];
				const res = await fetch(`https://api.hetzner.cloud/v1/zones?page=${page}&per_page=50`, {
					headers: bearer(fields.dns_hetzner_cloud_api_token),
				});
				if (res.status !== 200) failAnswer(res, { hint: "Read access to the project's DNS zones", secrets });
				if (!Array.isArray(res.json?.zones)) throw malformed(res, secrets);
				return {
					names: res.json.zones.map((zone) => zone?.name),
					more: Boolean(res.json.meta?.pagination?.next_page),
				};
			},
		}),
};
