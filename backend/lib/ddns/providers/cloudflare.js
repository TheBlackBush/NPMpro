import { jsonHeaders, plainTarget, refuseMultiple, zoneNotFound } from "./record-common.js";
import { bearer, collectZones, failAnswer, malformed } from "./zone-common.js";

const HINT = "Zone Read";

const authHeaders = (fields) =>
	fields.dns_cloudflare_api_token
		? bearer(fields.dns_cloudflare_api_token)
		: {
				"X-Auth-Email": fields.dns_cloudflare_email ?? "",
				"X-Auth-Key": fields.dns_cloudflare_api_key ?? "",
				Accept: "application/json",
			};

// Cloudflare error codes that mean the credential is refused (authentication or permission)
const AUTH_CODES = new Set([9109, 10_000, 9103, 9106, 6003, 6111]);
const isAuthRefusal = (body) => body?.errors?.some?.((error) => AUTH_CODES.has(error?.code)) === true;

const secretsOf = (fields) =>
	[fields.dns_cloudflare_api_token, fields.dns_cloudflare_api_key].filter((value) => typeof value === "string");

const API = "https://api.cloudflare.com/client/v4";

const check = (res, fields, okStatuses = [200]) => {
	const body = res.json;
	if (!okStatuses.includes(res.status) || body?.success === false) {
		failAnswer(res, { hint: HINT, secrets: secretsOf(fields), refused: isAuthRefusal(body) });
	}
};

/** The zone id: cached in meta, else looked up once by name */
const zoneIdOf = async ({ zone, fields, fetch, meta }) => {
	if (meta?.zone_id) return meta.zone_id;
	const res = await fetch(`${API}/zones?name=${encodeURIComponent(zone)}`, { headers: authHeaders(fields) });
	check(res, fields);
	if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
	const id = res.json.result[0]?.id;
	if (typeof id !== "string") throw zoneNotFound(res, secretsOf(fields));
	return id;
};

const recordValue = (type, content) => (type === "CNAME" ? plainTarget(content) : content);

export default {
	id: "cloudflare",
	label: "Cloudflare",
	credentialProvider: "cloudflare",
	recordTypes: ["A", "AAAA", "CNAME"],
	proxied: true,
	ipv6: true,
	adminOnly: false,
	wildcards: true,
	/** The record's values (more than one: the engine marks it Failed), its ttl and proxied flag; null when missing */
	async read({ zone, name, type, fields, fetch, meta }) {
		const zoneId = await zoneIdOf({ zone, fields, fetch, meta });
		const res = await fetch(
			`${API}/zones/${zoneId}/dns_records?type=${type}&name.exact=${encodeURIComponent(name)}`,
			{ headers: authHeaders(fields) },
		);
		check(res, fields);
		if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
		const records = res.json.result;
		if (records.length === 0) return null;
		const [first] = records;
		return {
			values: records.map((record) => recordValue(type, record?.content)),
			ttl: typeof first?.ttl === "number" ? first.ttl : null,
			proxied: first?.proxied === true,
			meta: { ...meta, zone_id: zoneId, record_id: first?.id ?? null },
		};
	},
	/** PATCH sends only content (and ttl when set): proxied and the comment stay; a create sends proxied: false */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseMultiple(existing);
		const zoneId = await zoneIdOf({ zone, fields, fetch, meta });
		const next = { ...meta, zone_id: zoneId };
		if (existing) {
			const recordId = meta?.record_id ?? existing.meta?.record_id;
			const body = { content: ip };
			if (ttl) body.ttl = ttl;
			const res = await fetch(`${API}/zones/${zoneId}/dns_records/${recordId}`, {
				method: "PATCH",
				headers: jsonHeaders(authHeaders(fields)),
				body: JSON.stringify(body),
			});
			check(res, fields);
			return { meta: { ...next, record_id: recordId }, created: false };
		}
		const res = await fetch(`${API}/zones/${zoneId}/dns_records`, {
			method: "POST",
			headers: jsonHeaders(authHeaders(fields)),
			body: JSON.stringify({ type, name, content: ip, ttl: ttl ?? 1, proxied: false }),
		});
		check(res, fields, [200, 201]);
		return { meta: { ...next, record_id: res.json?.result?.id ?? null }, created: true };
	},
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async (page) => {
				const res = await fetch(`https://api.cloudflare.com/client/v4/zones?page=${page}&per_page=50`, {
					headers: authHeaders(fields),
				});
				const body = res.json;
				if (res.status !== 200 || body?.success === false) {
					failAnswer(res, {
						hint: HINT,
						secrets: secretsOf(fields),
						refused: isAuthRefusal(body),
					});
				}
				if (!Array.isArray(body?.result) || typeof body?.result_info?.page !== "number") {
					throw malformed(res, secretsOf(fields));
				}
				return {
					names: body.result.map((zone) => zone?.name),
					more: body.result_info.page < (body.result_info.total_pages ?? 0),
				};
			},
		}),
};
