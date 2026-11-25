import { DdnsProviderError } from "../errors.js";
import {
	assertChallengeItem,
	changedSet,
	collectChallenges,
	fullName,
	PREFIX,
	requireId,
	sameValues,
	settleDelete,
	unquote,
} from "./challenge-common.js";
import {
	assertRemovable,
	jsonHeaders,
	judgeSet,
	plainTarget,
	refuseMultiple,
	sameAddress,
	zoneNotFound,
} from "./record-common.js";
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

const HEX_ID = /^[0-9a-f]{32}$/u;
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

const STALE_ZONE = Symbol("stale zone");

/**
 * Runs a call for the zone. A 404 for a cached zone id means the zone was recreated: the id is dropped and the call
 * runs once more with a fresh lookup (a 404 for a fresh id is a missing zone).
 */
const withZone = async (args, call) => {
	const cached = Boolean(args.meta?.zone_id);
	const zoneId = await zoneIdOf(args);
	const result = await call(args, zoneId);
	if (result !== STALE_ZONE) return result;
	if (!cached) throw zoneNotFound({ status: 404 }, secretsOf(args.fields));
	const { zone_id: _dropped, ...meta } = args.meta;
	const fresh = { ...args, meta };
	const again = await call(fresh, await zoneIdOf(fresh));
	if (again === STALE_ZONE) throw zoneNotFound({ status: 404 }, secretsOf(args.fields));
	return again;
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
	aliases: true,
	// the lowest TTL of a record that is not proxied on the plans below Enterprise (Cloudflare docs, TTL)
	minTtl: 60,
	/** The zone id as meta, looked up once: a caller that reads many names of a zone passes it to each read */
	async zoneMeta(args) {
		return { zone_id: await zoneIdOf({ ...args, meta: undefined }) };
	},
	/** The record's values (more than one: the engine marks it Failed), its ttl and proxied flag; null when missing */
	read(args) {
		return withZone(args, async ({ name, type, fields, fetch, meta }, zoneId) => {
			const res = await fetch(
				`${API}/zones/${zoneId}/dns_records?type=${type}&name.exact=${encodeURIComponent(name)}`,
				{ headers: authHeaders(fields) },
			);
			if (res.status === 404) return STALE_ZONE;
			check(res, fields);
			if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
			const records = res.json.result;
			if (records.length === 0) return null;
			const [first] = records;
			const proxied = first?.proxied === true;
			return {
				values: records.map((record) => recordValue(type, record?.content)),
				ttl: typeof first?.ttl === "number" ? first.ttl : null,
				proxied,
				meta: { ...meta, zone_id: zoneId, record_id: first?.id ?? null, proxied },
			};
		});
	},
	/**
	 * PATCH sends only content (and ttl when set and the record is not proxied): proxied and the comment stay; a
	 * create sends proxied: false
	 */
	write(args) {
		try {
			refuseMultiple(args.existing);
		} catch (err) {
			return Promise.reject(err);
		}
		return withZone(args, async ({ name, type, ip, ttl, existing, fields, fetch, meta }, zoneId) => {
			const next = { ...meta, zone_id: zoneId };
			if (existing) {
				const recordId = meta?.record_id ?? existing.meta?.record_id;
				if (!recordId) {
					throw new DdnsProviderError({
						code: "failed",
						message: "The record id is not known; the record is read again on the next check",
						secrets: secretsOf(fields),
					});
				}
				const proxied = meta?.proxied === true || existing.proxied === true;
				const body = { content: ip };
				if (ttl && !proxied) body.ttl = ttl;
				const res = await fetch(`${API}/zones/${zoneId}/dns_records/${recordId}`, {
					method: "PATCH",
					headers: jsonHeaders(authHeaders(fields)),
					body: JSON.stringify(body),
				});
				if (res.status === 404) return STALE_ZONE;
				check(res, fields);
				return { meta: { ...next, record_id: recordId }, created: false };
			}
			const res = await fetch(`${API}/zones/${zoneId}/dns_records`, {
				method: "POST",
				headers: jsonHeaders(authHeaders(fields)),
				body: JSON.stringify({ type, name, content: ip, ttl: ttl ?? 1, proxied: false }),
			});
			if (res.status === 404) return STALE_ZONE;
			check(res, fields, [200, 201]);
			return { meta: { ...next, record_id: res.json?.result?.id ?? null }, created: true };
		});
	},
	/**
	 * Deletes the A or AAAA record NPMpro wrote: the records of the name and type are read first, and only one record
	 * that holds exactly `value` (and the stored id, when there is one) is deleted; another value, a second record or
	 * another id is another client's and is kept (`changed`). An answer that is not a success is read again.
	 */
	async remove({ zone, name, type, value, fields, fetch, meta }) {
		const wanted = assertRemovable({ zone, name, type, value });
		const zoneId = await zoneIdOf({ zone, fields, fetch, meta });
		const find = async () => {
			const res = await fetch(
				`${API}/zones/${zoneId}/dns_records?type=${type}&name.exact=${encodeURIComponent(wanted)}`,
				{ headers: authHeaders(fields) },
			);
			check(res, fields);
			if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
			return res.json.result.filter(
				(entry) => entry?.type === type && String(entry?.name).toLowerCase() === wanted,
			);
		};
		const records = await find();
		const verdict = judgeSet(
			records.map((entry) => entry.content),
			value,
		);
		if (verdict === "gone") return { gone: true };
		const [record] = records;
		if (verdict === "changed" || (meta?.record_id && meta.record_id !== record.id)) return changedSet();
		requireId(record, (id) => typeof id === "string" && HEX_ID.test(id));
		const res = await fetch(`${API}/zones/${zoneId}/dns_records/${record.id}`, {
			method: "DELETE",
			headers: authHeaders(fields),
		});
		return settleDelete({
			res,
			ok: (answer) => answer.status === 200 && answer.json?.success !== false,
			recheck: async () => !(await find()).some((entry) => sameAddress(entry.content, value)),
			fail: (answer) => check(answer, fields),
		});
	},
	/**
	 * After a 401 or 403 of the zone list: the token verify call tells a wrong token (401, code 1000) from a missing
	 * right; any other answer (an account owned token, a key group) stays "refused". Reads only.
	 */
	async verifyRefusal({ fields, fetch }) {
		if (!fields.dns_cloudflare_api_token) return "refused";
		const res = await fetch(`${API}/user/tokens/verify`, { headers: authHeaders(fields) });
		const wrong = res.status === 401 && res.json?.errors?.some?.((error) => error?.code === 1000) === true;
		return wrong ? "wrong-key" : "refused";
	},
	/** The TXT records (and CNAMEs, counted) at or below _acme-challenge: the name filter is a prefix, filtered again here */
	async listChallenges({ zone, fields, fetch }) {
		const zoneId = await zoneIdOf({ zone, fields, fetch });
		return collectChallenges({
			zone,
			fetchPage: async (page) => {
				const res = await fetch(
					`${API}/zones/${zoneId}/dns_records?name.startswith=${PREFIX}&per_page=100&page=${page}`,
					{ headers: authHeaders(fields) },
				);
				check(res, fields);
				if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
				const info = res.json.result_info;
				return {
					records: res.json.result.map((record) => ({
						name: fullName(zone, record?.name),
						type: record?.type,
						id: record?.id,
						values: [record?.content],
						changed_on: record?.modified_on ?? record?.created_on,
					})),
					more: typeof info?.page === "number" && info.page < (info.total_pages ?? 0),
				};
			},
		});
	},
	/**
	 * Reads the records at the item's name first and deletes only the TXT record with the listed id and value (another
	 * record, name or value is "changed", an absent one "gone"); an answer that is not a success is checked by a new read.
	 */
	async removeChallenge({ zone, item, fields, fetch }) {
		assertChallengeItem(zone, item);
		requireId(item, (id) => typeof id === "string" && HEX_ID.test(id));
		const zoneId = await zoneIdOf({ zone, fields, fetch });
		const find = async () => {
			const res = await fetch(`${API}/zones/${zoneId}/dns_records?name.exact=${encodeURIComponent(item.name)}`, {
				headers: authHeaders(fields),
			});
			check(res, fields);
			if (!Array.isArray(res.json?.result)) throw malformed(res, secretsOf(fields));
			return res.json.result.find((entry) => entry?.id === item.id) ?? null;
		};
		const record = await find();
		if (record === null) return { gone: true };
		if (
			record.type !== "TXT" ||
			fullName(zone, record.name) !== item.name ||
			!sameValues([unquote(record.content)], item.values)
		) {
			return changedSet();
		}
		const res = await fetch(`${API}/zones/${zoneId}/dns_records/${item.id}`, {
			method: "DELETE",
			headers: authHeaders(fields),
		});
		return settleDelete({
			res,
			ok: (answer) => answer.status === 200 && answer.json?.success !== false,
			recheck: async () => (await find()) === null,
			fail: (answer) => check(answer, fields),
		});
	},
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
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
