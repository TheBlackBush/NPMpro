import { createHash } from "node:crypto";
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
	judgeSet,
	plainTarget,
	recordGone,
	refuseMultiple,
	refuseWildcard,
	relativeName,
	sameAddress,
	zoneNotFound,
} from "./record-common.js";
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
// the records of a challenge listing are read this many per page
const CHALLENGE_BATCH = 20;
const zonePath = (zone) => `/domain/zone/${encodeURIComponent(zone)}`;

/** The API refuses new apex names, so this is reached only for a stored apex record. The apex is refused until OVH documents how it is spelled (the spec only says subDomain is a nullable string) */
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
const refreshZone = async ({ zone, fields, fetch, did = "saved" }) => {
	const res = await ovhRequest({ fields, fetch, method: "POST", path: `${zonePath(zone)}/refresh` });
	if (res.status >= 200 && res.status < 300) return;
	try {
		if (res.status === 404) throw zoneNotFound(res, secretsOf(fields));
		failAnswer(res, { hint: HINT, secrets: secretsOf(fields) });
	} catch (err) {
		err.message = `The record was ${did} but the zone refresh failed: ${err.message}`;
		throw err;
	}
};

/** The refresh after a saved change: when it fails the error carries refresh_pending, so the next run refreshes first */
const refreshAfterSave = async ({ zone, fields, fetch, meta, recordId }) => {
	try {
		await refreshZone({ zone, fields, fetch });
	} catch (err) {
		err.meta = { ...meta, record_id: recordId, refresh_pending: true };
		throw err;
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
		// an earlier change was saved but its refresh failed: do it first, a failure here keeps the flag and backs off
		if (meta?.refresh_pending === true) await refreshZone({ zone, fields, fetch });
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
			meta: { ...meta, record_id: first.id, refresh_pending: false },
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
			const res = await ovhRequest({
				fields,
				fetch,
				method: "PUT",
				path: `${zonePath(zone)}/record/${recordId}`,
				body: { target: ip, ...ttlPart },
			});
			if (res.status === 404) throw recordGone(res, secrets);
			if (res.status < 200 || res.status >= 300) failAnswer(res, { hint: HINT, secrets });
			await refreshAfterSave({ zone, fields, fetch, meta, recordId });
			return { meta: { ...meta, record_id: recordId, refresh_pending: false }, created: false };
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
		const createdId = Number.isInteger(res.json?.id) ? res.json.id : null;
		await refreshAfterSave({ zone, fields, fetch, meta, recordId: createdId });
		return { meta: { ...meta, record_id: createdId, refresh_pending: false }, created: true };
	},
	// a wrong key and a missing right both answer 403 (observed): the Test says "refused"
	/**
	 * The TXT records of the zone: the id list, then each record in batches of 20 (one batch is one page). The name
	 * filter's matching is not documented, so the prefix is filtered here. Records have no time.
	 */
	async listChallenges({ zone, fields, fetch }) {
		const secrets = secretsOf(fields);
		const listIds = async (query) => {
			const res = await ovhRequest({ fields, fetch, path: `${zonePath(zone)}/record?${query}` });
			if (res.status === 404) throw zoneNotFound(res, secrets);
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			if (!Array.isArray(res.json) || !res.json.every(Number.isInteger)) throw malformed(res, secrets);
			return res.json;
		};
		const readRecord = async (id) => {
			const res = await ovhRequest({ fields, fetch, path: `${zonePath(zone)}/record/${id}` });
			// a record deleted since the list was read is no record
			if (res.status === 404) return null;
			if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
			if (typeof res.json?.target !== "string") throw malformed(res, secrets);
			return res.json;
		};
		const ids = await listIds("fieldType=TXT");
		return collectChallenges({
			zone,
			fetchPage: async (page) => {
				const batch = ids.slice((page - 1) * CHALLENGE_BATCH, page * CHALLENGE_BATCH);
				const records = [];
				for (const id of batch) {
					const record = await readRecord(id);
					if (record) {
						records.push({
							name: fullName(zone, record.subDomain, true),
							type: record.fieldType,
							id,
							values: [record.target],
						});
					}
				}
				return { records, more: page * CHALLENGE_BATCH < ids.length };
			},
			cnames: async () => {
				const found = await listIds(`fieldType=CNAME&subDomain=${PREFIX}`);
				let count = 0;
				for (const id of found.slice(0, MAX_RECORDS)) {
					const record = await readRecord(id);
					if (record?.fieldType === "CNAME" && String(record.subDomain ?? "").toLowerCase() === PREFIX)
						count++;
				}
				return count;
			},
		});
	},
	/**
	 * Reads the record first and deletes only the TXT record with the listed name and value, then refreshes the zone
	 * (a failed refresh is a failure)
	 */
	async removeChallenge({ zone, item, fields, fetch }) {
		assertChallengeItem(zone, item);
		requireId(item, (id) => Number.isInteger(id) && id > 0);
		const secrets = secretsOf(fields);
		const path = `${zonePath(zone)}/record/${item.id}`;
		const read = await ovhRequest({ fields, fetch, path });
		if (read.status === 404) return { gone: true };
		if (read.status !== 200) failAnswer(read, { hint: HINT, secrets });
		const record = read.json;
		if (
			record?.fieldType !== "TXT" ||
			fullName(zone, record.subDomain, true) !== item.name ||
			!sameValues([unquote(record.target)], item.values)
		) {
			return changedSet();
		}
		const res = await ovhRequest({ fields, fetch, method: "DELETE", path });
		const done = await settleDelete({
			res,
			ok: (answer) => answer.status >= 200 && answer.status < 300,
			recheck: async () => (await ovhRequest({ fields, fetch, path })).status === 404,
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets }),
		});
		if (!done.gone) await refreshZone({ zone, fields, fetch, did: "deleted" });
		return done;
	},
	/**
	 * Deletes the A or AAAA record NPMpro wrote: the records of the name and type are read first and only one record
	 * that holds exactly `value` is deleted, then the zone is refreshed (a failed refresh is a failure)
	 */
	async remove({ zone, name, type, value, fields, fetch, meta }) {
		const wanted = assertRemovable({ zone, name, type, value });
		refusals(zone, wanted);
		const secrets = secretsOf(fields);
		if (meta?.refresh_pending === true) await refreshZone({ zone, fields, fetch });
		const sub = relativeName(zone, wanted);
		const find = async () => {
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
				if (res.status === 404) continue;
				if (res.status !== 200) failAnswer(res, { hint: HINT, secrets });
				if (typeof res.json?.target !== "string") throw malformed(res, secrets);
				if (res.json.fieldType === type && String(res.json.subDomain ?? "").toLowerCase() === sub) {
					records.push({ id, target: res.json.target });
				}
			}
			return records;
		};
		const records = await find();
		const verdict = judgeSet(
			records.map((entry) => entry.target),
			value,
		);
		if (verdict === "gone") return { gone: true };
		const [record] = records;
		if (verdict === "changed" || (meta?.record_id && meta.record_id !== record.id)) return changedSet();
		requireId(record, (id) => Number.isInteger(id) && id > 0);
		const path = `${zonePath(zone)}/record/${record.id}`;
		const res = await ovhRequest({ fields, fetch, method: "DELETE", path });
		const done = await settleDelete({
			res,
			ok: (answer) => answer.status >= 200 && answer.status < 300,
			recheck: async () => !(await find()).some((entry) => sameAddress(entry.target, value)),
			fail: (answer) => failAnswer(answer, { hint: HINT, secrets }),
		});
		if (!done.gone) await refreshZone({ zone, fields, fetch, did: "deleted" });
		return done;
	},
	listZones: ({ fields, fetch, maxPages }) =>
		collectZones({
			maxPages,
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const res = await ovhRequest({ fields, fetch, path: "/domain/zone" });
				if (res.status !== 200) failAnswer(res, { hint: "A right on GET /domain/zone", secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return { names: res.json, more: false };
			},
		}),
};
