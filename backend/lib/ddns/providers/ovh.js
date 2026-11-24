import { createHash } from "node:crypto";
import { DdnsProviderError } from "../errors.js";
import { plainTarget, refuseMultiple, refuseWildcard, relativeName, zoneNotFound } from "./record-common.js";
import { collectZones, failAnswer, malformed } from "./zone-common.js";

// OVH signs every request: "$1$" + sha1(secret + "+" + consumer + "+" + method + "+" + url + "+" + body + "+" +
// timestamp), the timestamp being the server's (GET /auth/time), as python-ovh and ovh.js do.

const ENDPOINTS = Object.freeze({
	"ovh-eu": "https://eu.api.ovh.com/1.0",
	"ovh-ca": "https://ca.api.ovh.com/1.0",
	"ovh-us": "https://api.us.ovhcloud.com/1.0",
	"kimsufi-eu": "https://eu.api.kimsufi.com/1.0",
	"kimsufi-ca": "https://ca.api.kimsufi.com/1.0",
	"soyoustart-eu": "https://eu.api.soyoustart.com/1.0",
	"soyoustart-ca": "https://ca.api.soyoustart.com/1.0",
});

/**
 * @param   {*} value  the endpoint name of the credential
 * @returns {String|null}  the base URL, or null for an unknown name
 */
const ovhEndpoint = (value) => (typeof value === "string" && Object.hasOwn(ENDPOINTS, value) ? ENDPOINTS[value] : null);

const ovhSignature = ({ secret, consumer, method, url, body, timestamp }) =>
	`$1$${createHash("sha1").update(`${secret}+${consumer}+${method}+${url}+${body}+${timestamp}`).digest("hex")}`;

const secretsOf = (fields) => [fields.dns_ovh_application_secret, fields.dns_ovh_consumer_key];

/**
 * One signed OVH call. Reads the server time once per call so a skewed clock still signs right. Never throws for
 * a 4xx or 5xx (the caller decides), throws DdnsProviderError for a network failure or an unknown endpoint.
 *
 * @param   {Object}   options
 * @param   {Object}   options.fields   the credential values
 * @param   {Function} options.fetch    providerFetch bound to the secrets
 * @param   {String}   [options.method]
 * @param   {String}   options.path     starting with "/"
 * @param   {*}        [options.body]   serialized to JSON when given
 * @returns {Promise<{status: number, headers: Headers, text: String, json: *}>}
 */
const ovhRequest = async ({ fields, fetch, method = "GET", path, body }) => {
	const secrets = secretsOf(fields);
	const base = ovhEndpoint(fields.dns_ovh_endpoint);
	if (base === null) throw new DdnsProviderError({ code: "failed", message: "Unknown OVH endpoint", retry: false });
	const time = await fetch(`${base}/auth/time`, { headers: { Accept: "application/json" } });
	const timestamp = Number.isInteger(time.json) ? time.json : Number.parseInt(time.text, 10);
	if (time.status !== 200 || !Number.isInteger(timestamp)) failAnswer(time, { hint: "", secrets });
	const url = `${base}${path}`;
	const payload = body === undefined ? "" : JSON.stringify(body);
	return fetch(url, {
		method,
		body: payload === "" ? undefined : payload,
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Ovh-Application": fields.dns_ovh_application_key,
			"X-Ovh-Consumer": fields.dns_ovh_consumer_key,
			"X-Ovh-Timestamp": String(timestamp),
			"X-Ovh-Signature": ovhSignature({
				secret: fields.dns_ovh_application_secret,
				consumer: fields.dns_ovh_consumer_key,
				method,
				url,
				body: payload,
				timestamp,
			}),
		},
	});
};

const HINT = "A right on /domain/zone/{zone}/record and /domain/zone/{zone}/refresh";
// one name has a handful of records; a longer list is not one record set and is not changed
const MAX_RECORDS = 20;
const zonePath = (zone) => `/domain/zone/${encodeURIComponent(zone)}`;

/** The apex is refused until OVH documents how it is spelled (the spec only says subDomain is a nullable string) */
const refuseApex = (zone, name) => {
	if (name.toLowerCase() === zone.toLowerCase()) {
		throw new DdnsProviderError({
			code: "failed",
			message: "OVH records at the zone apex are not supported",
			retry: false,
		});
	}
};

const refusals = (zone, name) => {
	refuseWildcard(name);
	refuseApex(zone, name);
};

/** Applies the pending record changes: OVH shows a change in the zone only after this call */
const refreshZone = async ({ zone, fields, fetch }) => {
	const res = await ovhRequest({ fields, fetch, method: "POST", path: `${zonePath(zone)}/refresh` });
	if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
	if (res.status < 200 || res.status >= 300) {
		try {
			failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
		} catch (err) {
			err.message = `The record was saved but the zone refresh failed: ${err.message}`;
			throw err;
		}
	}
};

export { ovhEndpoint, ovhRequest, ovhSignature };

export default {
	id: "ovh",
	label: "OVH",
	credentialProvider: "ovh",
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: false,
	// not confirmed by OVH's own documentation: wildcard names, CNAME targets and the apex are refused, and the
	// API spec has no minimum TTL, so a too low TTL shows as the failed answer
	wildcards: false,
	aliases: false,
	apex: false,
	minTtl: null,
	/** The records of the name and type (one id list, then each record: the name filter is a pattern match) */
	async read({ zone, name, type, fields, fetch, meta }) {
		refusals(zone, name);
		const secrets = secretsOf(fields);
		const sub = relativeName(zone, name);
		const list = await ovhRequest({
			fields,
			fetch,
			path: `${zonePath(zone)}/record?fieldType=${encodeURIComponent(type)}&subDomain=${encodeURIComponent(sub)}`,
		});
		if (list.status === 404) throw zoneNotFound(list, secrets);
		if (list.status !== 200) failAnswer(list, { hint: HINT, secrets });
		if (!Array.isArray(list.json) || !list.json.every(Number.isInteger)) throw malformed(list, secrets);
		if (list.json.length > MAX_RECORDS) {
			throw new DdnsProviderError({ code: "failed", message: "The name has too many records", retry: false });
		}
		const records = [];
		for (const id of list.json) {
			const res = await ovhRequest({ fields, fetch, path: `${zonePath(zone)}/record/${id}` });
			// a record deleted since the list was read is no record
			if (res.status === 404) continue;
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			if (typeof res.json?.target !== "string") throw malformed(res, secrets);
			if (res.json.fieldType === type && String(res.json.subDomain ?? "").toLowerCase() === sub) {
				records.push({ id, target: res.json.target, ttl: res.json.ttl });
			}
		}
		if (records.length === 0) return null;
		const [first] = records;
		return {
			values: records.map((record) => (type === "CNAME" ? plainTarget(record.target) : record.target)),
			ttl: Number.isInteger(first.ttl) && first.ttl > 0 ? first.ttl : null,
			meta: { ...meta, record_id: first.id },
		};
	},
	/** A change (PUT) or a create (POST) only becomes visible after the refresh, and a failed refresh is a failure */
	async write({ zone, name, type, ip, ttl, existing, fields, fetch, meta }) {
		refusals(zone, name);
		refuseMultiple(existing);
		const secrets = secretsOf(fields);
		const recordId = meta?.record_id ?? existing?.meta?.record_id;
		const ttlPart = Number.isInteger(ttl) && ttl > 0 ? { ttl } : {};
		if (existing) {
			if (!recordId) {
				throw new DdnsProviderError({
					code: "failed",
					message: "The record id is not known; the record is read again on the next check",
					secrets,
				});
			}
			const res = await ovhRequest({
				fields,
				fetch,
				method: "PUT",
				path: `${zonePath(zone)}/record/${recordId}`,
				body: { target: ip, ...ttlPart },
			});
			if (res.status === 404) throw zoneNotFound(res, secrets);
			if (res.status < 200 || res.status >= 300) failAnswer(res, { hint: HINT, secrets });
			await refreshZone({ zone, fields, fetch });
			return { meta: { ...meta, record_id: recordId }, created: false };
		}
		const res = await ovhRequest({
			fields,
			fetch,
			method: "POST",
			path: `${zonePath(zone)}/record`,
			body: { fieldType: type, subDomain: relativeName(zone, name), target: ip, ...ttlPart },
		});
		if (res.status === 404) throw zoneNotFound(res, secrets);
		if (res.status < 200 || res.status >= 300) failAnswer(res, { hint: HINT, secrets });
		await refreshZone({ zone, fields, fetch });
		return { meta: { ...meta, record_id: Number.isInteger(res.json?.id) ? res.json.id : null }, created: true };
	},
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const res = await ovhRequest({ fields, fetch, path: "/domain/zone" });
				if (res.status !== 200) failAnswer(res, { hint: "A right on GET /domain/zone", secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return { names: res.json, more: false };
			},
		}),
};
