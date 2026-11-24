import { DdnsProviderError } from "../errors.js";
import { recordGone, refuseMultiple, refuseWildcard, relativeName, zoneNotFound } from "./record-common.js";
import { failAnswer, malformed } from "./zone-common.js";

const BASE = "https://api.porkbun.com/api/json/v3";
const HINT = "An API key with DNS access, and API access switched on for the domain";
// "typically 600": the account setting decides, so a lower value than the account allows shows as the failed answer
const MIN_TTL = 600;
const REFUSED_CODES = /^(?:INVALID_API_KEYS|MISSING_|API_ACCESS_DISABLED)/u;
const MISSING_RECORD = /not found|could not find|cannot find|does not exist|no record|no such/iu;

const secretsOf = (fields) =>
	[fields.dns_porkbun_key, fields.dns_porkbun_secret].filter((value) => typeof value === "string" && value !== "");

const checkTtl = (ttl) => {
	if (ttl === undefined || ttl === null) return;
	if (!Number.isInteger(ttl) || ttl < MIN_TTL) {
		throw new DdnsProviderError({
			code: "failed",
			message: `Porkbun needs a TTL of at least ${MIN_TTL} seconds`,
			retry: false,
		});
	}
};

/**
 * One call: POST with both credentials in the JSON body (the secrets are scrubbed from every error). The answer is
 * a success only with HTTP 2xx and `status: SUCCESS`; a 4xx or an ERROR status is thrown here, so a caller gets
 * only a good answer, or null for the cases it handles itself (`missing`).
 *
 * @param   {Object}   options
 * @param   {String}   options.path     after /api/json/v3
 * @param   {Object}   [options.body]   the fields besides the credentials
 * @param   {Function} [options.missing] (res) => boolean: an answer the caller reads as "no such record"
 * @returns {Promise<Object|null>}  the parsed answer, or null when `missing` matched
 */
const call = async ({ fields, fetch, path, body = {}, missing }) => {
	const secrets = secretsOf(fields);
	const res = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ apikey: fields.dns_porkbun_key, secretapikey: fields.dns_porkbun_secret, ...body }),
	});
	if (res.status >= 200 && res.status < 300 && res.json?.status === "SUCCESS") return res.json;
	if (missing?.(res)) return null;
	const code = typeof res.json?.code === "string" ? res.json.code : "";
	if (code === "INVALID_DOMAIN") throw zoneNotFound(res, secrets);
	if (res.status >= 200 && res.status < 300 && res.json?.status !== "ERROR") throw malformed(res, secrets);
	failAnswer(res, { hint: HINT, secrets, refused: REFUSED_CODES.test(code) });
	return null;
};

const zonePart = (zone) => encodeURIComponent(zone);
const subPart = (zone, name) => {
	const sub = relativeName(zone, name);
	return sub === "@" ? "" : `/${encodeURIComponent(sub)}`;
};

export default {
	id: "porkbun",
	label: "Porkbun",
	credentialProvider: "porkbun",
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	// the wildcard form is confirmed for create only, and the CNAME rules are not stated: both are refused
	wildcards: false,
	aliases: false,
	minTtl: MIN_TTL,
	/** The records of the name and type; an empty answer is "missing", so a create follows */
	async read({ zone, name, type, fields, fetch, meta }) {
		refuseWildcard(name);
		const secrets = secretsOf(fields);
		const answer = await call({
			fields,
			fetch,
			path: `/dns/retrieveByNameType/${zonePart(zone)}/${type}${subPart(zone, name)}`,
		});
		if (!Array.isArray(answer.records)) throw malformed({ status: 200 }, secrets);
		const wanted = name.toLowerCase();
		const records = answer.records.filter(
			(record) => record?.type === type && String(record?.name ?? "").toLowerCase() === wanted,
		);
		if (records.length === 0) return null;
		if (!records.every((record) => typeof record.content === "string")) throw malformed({ status: 200 }, secrets);
		const [first] = records;
		const ttl = Number.parseInt(first.ttl, 10);
		return {
			values: records.map((record) => record.content),
			ttl: Number.isInteger(ttl) && ttl > 0 ? ttl : null,
			// an id is a string in a read and a number in a create: kept as it came
			meta: { ...meta, record_id: first.id ?? null },
		};
	},
	/**
	 * An edit by name and type replaces every matching record, so a set with several values is refused. The edit
	 * body holds content and ttl only (type and name are in the URL); a record that is gone is a retried failure.
	 */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refuseWildcard(name);
		refuseMultiple(existing);
		checkTtl(ttl);
		const secrets = secretsOf(fields);
		if (existing) {
			// a TTL left out is not known to keep the old one: send the record's own
			const keep = ttl ?? (Number.isInteger(existing.ttl) && existing.ttl >= MIN_TTL ? existing.ttl : undefined);
			const done = await call({
				fields,
				fetch,
				path: `/dns/editByNameType/${zonePart(zone)}/${type}${subPart(zone, name)}`,
				body: { content: ip, ...(keep === undefined ? {} : { ttl: keep }) },
				missing: (res) => res.status === 404 || MISSING_RECORD.test(String(res.json?.message ?? "")),
			});
			if (done === null) throw recordGone({ status: 404 }, secrets);
			return { meta: { ...meta }, created: false };
		}
		const sub = relativeName(zone, name);
		const done = await call({
			fields,
			fetch,
			path: `/dns/create/${zonePart(zone)}`,
			body: { type, ...(sub === "@" ? {} : { name: sub }), content: ip, ...(ttl ? { ttl } : {}) },
		});
		return { meta: { ...meta, record_id: done.id ?? null }, created: true };
	},
};
