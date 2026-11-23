import { fromDbTime, toDbTime } from "../lib/ddns/db-time.js";
import { isIpv6Suffix } from "../lib/ddns/ipv6.js";
import { updaterFor } from "../lib/ddns/providers/index.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { ownerLock } from "../lib/dns-domain-lock.js";
import { bareName, coveringZone } from "../lib/dns-domain-match.js";
import { normalizeDomainName } from "../lib/dns-domain-name.js";
import errs from "../lib/error.js";
import { createKeyedLock } from "../lib/keyed-lock.js";
import ddnsHistoryModel from "../models/ddns_history.js";
import ddnsRecordModel from "../models/ddns_record.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalAuditLog from "./audit-log.js";
import internalDnsCredential from "./dns-credential.js";

// The DDNS records: the API side (list, create, change, delete, history) and the store the engine reads and writes.
// One run at a time per record (recordLock, shared with the engine) and one name check at a time (nameLock).

const recordLock = createKeyedLock();
const nameLock = createKeyedLock();

const HISTORY_SHOWN = 50;
const TIME_KEYS = ["last_checked_on", "last_changed_on", "next_try_on"];
const GRAPH = "[credential,owner]";

const refusal = (message, key, values) => new errs.ValidationError(message, key, values ? { values } : undefined);

const isWildcard = (name) => name.startsWith("*.");

/**
 * A record name as hosts keep names: lower case, punycode, no trailing dot; a leading "*." is kept
 *
 * @param   {unknown}  input
 * @returns {String}
 * @throws  {errs.ValidationError}  error.ddns-name-invalid
 */
const normalizeRecordName = (input) => {
	const text = typeof input === "string" ? input.trim() : "";
	const wildcard = isWildcard(text);
	const done = normalizeDomainName(wildcard ? text.slice(2) : text);
	if (done.error) {
		throw refusal(`'${input}' is not a valid record name such as home.example.com`, "error.ddns-name-invalid", {
			name: String(input),
		});
	}
	return wildcard ? `*.${done.name}` : done.name;
};

const covers = (zone, name) => {
	const host = bareName(name);
	return host === zone || host.endsWith(`.${zone}`);
};

// a record is visible when its credential is; a record without a credential (the custom provider) to its owner
const visibleRecords = (access, trx) => {
	const query = ddnsRecordModel.query(trx);
	if (access.visibility !== "all") {
		const userId = access.token.getUserId(1);
		query.where((builder) =>
			builder
				.whereIn(
					"npmpro_ddns_record.dns_credential_id",
					dnsCredentialModel.query(trx).select("id").where("owner_user_id", userId),
				)
				.orWhere((own) =>
					own
						.whereNull("npmpro_ddns_record.dns_credential_id")
						.where("npmpro_ddns_record.owner_user_id", userId),
				),
		);
	}
	return query;
};

const iso = (value) => fromDbTime(value)?.toISOString() ?? null;

/** The API form of a row: no meta or secret, ISO times, the engine's translatable error and the proxied flag */
const toPublic = (row) => {
	const { meta, ...json } = row.toJSON();
	for (const key of TIME_KEYS) json[key] = iso(row[key]);
	// an alias follows no address: the column keeps its NOT NULL default, the answer says none
	if (json.kind === "alias") Object.assign(json, { ip_version: null, ipv6_suffix: null });
	return {
		...json,
		error_i18n: meta?.error_i18n ?? null,
		error_values: meta?.error_values ?? null,
		proxied: typeof meta?.proxied === "boolean" ? meta.proxied : null,
	};
};

const auditMeta = (row, credential) => ({
	name: row.name,
	provider: row.provider,
	kind: row.kind,
	...(row.target ? { target: row.target } : {}),
	...(credential ? { dns_credential_id: credential.id, credential_name: credential.name } : {}),
});

const credentialOf = async (row) =>
	row.dns_credential_id === null ? null : await dnsCredentialModel.query().findById(row.dns_credential_id);

// the zone to suggest for a name: its parent when it has three labels or more (a guess; the user can type another)
const suggestedZone = (name) => {
	const host = bareName(name);
	const labels = host.split(".");
	return labels.length > 2 ? labels.slice(1).join(".") : host;
};

// a typed zone, normalized; it must cover the name
const typedZoneFor = (name, typed) => {
	const done = normalizeDomainName(typed);
	if (done.error || !covers(done.name, name)) {
		throw refusal(`${name} is not inside the zone ${typed}`, "error.ddns-zone-mismatch", {
			name,
			zone: String(typed),
		});
	}
	return done.name;
};

/**
 * The zone of a name: the longest domain of the credential that covers it, else a typed zone that covers it
 */
const zoneFor = async (credential, name, typed) => {
	const domains = await dnsDomainModel.query().where("dns_credential_id", credential.id);
	const zones = domains.map((stored) => ({
		name: stored.name,
		credentialId: credential.id,
		ownerUserId: credential.owner_user_id,
	}));
	const found = coveringZone(name, zones, credential.owner_user_id);
	if (found) return found.zone;
	if (typed !== null) return typedZoneFor(name, typed);
	const domain = suggestedZone(name);
	throw refusal(`Add ${domain} to ${credential.name} first, or type the zone`, "error.ddns-no-zone", {
		domain,
		credential: credential.name,
	});
};

/**
 * The values a save stores. Rules run on new or changed values only: a stored value passes a save that keeps it.
 *
 * @param   {Access}       access
 * @param   {Object}       data  the request
 * @param   {Object|null}  row   the stored record (an update)
 * @returns {Promise<Object>}  { values, credential, changed }
 */
const resolveSave = async (access, data, row) => {
	const credentialId = data.dns_credential_id ?? row?.dns_credential_id;
	const credentialChanged = row === null || credentialId !== row.dns_credential_id;
	const credential = await internalDnsCredential.get(access, { id: credentialId });
	const updater = updaterFor(credential.provider);
	if (updater === null) {
		throw refusal(`The provider of '${credential.name}' has no dynamic DNS updater`, "error.ddns-no-updater", {
			provider: credential.provider,
		});
	}
	if (data.provider !== undefined && data.provider !== null && data.provider !== updater.id) {
		throw refusal(
			`The credential's provider is ${updater.id}, not ${data.provider}`,
			"error.ddns-provider-mismatch",
			{
				provider: String(data.provider),
			},
		);
	}

	const nameChanged = row === null || (data.name !== undefined && data.name !== row.name);
	const name = nameChanged ? normalizeRecordName(data.name) : row.name;
	const renamed = row === null || name !== row.name;
	if ((renamed || credentialChanged) && isWildcard(name) && !updater.wildcards) {
		throw refusal(`${updater.label} does not support wildcard records`, "error.ddns-wildcard-unsupported", {
			provider: updater.label,
		});
	}

	let zone = row?.zone;
	const typedZone = data.zone !== undefined && data.zone !== null && data.zone !== "" ? data.zone : null;
	if (row === null || renamed || credentialChanged) zone = await zoneFor(credential, name, typedZone);
	else if (typedZone !== null && typedZone !== row.zone) zone = typedZoneFor(name, typedZone);

	const kind = data.kind ?? row?.kind ?? "address";
	const kindChanged = row === null || kind !== row.kind;
	const ttl = data.ttl !== undefined ? data.ttl : (row?.ttl ?? null);
	if (ttl !== null && ttl < updater.minTtl && (row === null || ttl !== row.ttl || credentialChanged)) {
		throw refusal(`${updater.label} takes a TTL of at least ${updater.minTtl} seconds`, "error.ddns-ttl-min", {
			min: updater.minTtl,
			provider: updater.label,
		});
	}
	// the record belongs to its credential's owner (visibility follows the credential), whoever saves it
	const values = {
		owner_user_id: credential.owner_user_id,
		dns_credential_id: credential.id,
		provider: updater.id,
		name,
		zone,
		kind,
		ttl,
		enabled: data.enabled ?? row?.enabled ?? true,
	};

	const suffixInput = data.ipv6_suffix !== undefined ? data.ipv6_suffix : (row?.ipv6_suffix ?? null);
	const suffix = typeof suffixInput === "string" && suffixInput.trim() !== "" ? suffixInput.trim() : null;
	if (kind === "alias") {
		const targetChanged = row === null || kindChanged || (data.target !== undefined && data.target !== row.target);
		let target = row?.target ?? null;
		if (targetChanged) {
			if (typeof data.target !== "string" || data.target.trim() === "") {
				throw refusal("An alias needs a target name", "error.ddns-alias-target-required");
			}
			const done = normalizeDomainName(data.target);
			if (done.error) {
				throw refusal(`'${data.target}' is not a valid target name`, "error.ddns-target-invalid", {
					target: data.target,
				});
			}
			target = done.name;
		}
		if ((targetChanged || renamed) && target === name) {
			throw refusal("An alias cannot point to its own name", "error.ddns-alias-self", { name });
		}
		// a CNAME cannot sit at the zone apex beside the zone's SOA and NS records
		if ((kindChanged || renamed || zone !== row.zone) && name === zone) {
			throw refusal(`An alias cannot be the zone apex ${zone}`, "error.ddns-alias-apex", { name });
		}
		const keepsIp = row !== null && !kindChanged && row.ip_version === data.ip_version;
		if (
			(data.ip_version !== undefined && data.ip_version !== null && !keepsIp) ||
			(suffix !== null && (kindChanged || suffix !== row?.ipv6_suffix))
		) {
			throw refusal(
				"An alias follows no address: it takes no IP version or IPv6 suffix",
				"error.ddns-alias-no-ip",
			);
		}
		Object.assign(values, { target, ip_version: "ipv4", ipv6_suffix: null });
	} else {
		const hasTarget = typeof data.target === "string" && data.target.trim() !== "";
		if (hasTarget) throw refusal("An address record takes no target", "error.ddns-address-no-target");
		const ipVersion = data.ip_version ?? (kindChanged ? "ipv4" : row.ip_version);
		const suffixChanged = suffix !== (kindChanged ? null : (row?.ipv6_suffix ?? null));
		if (suffix !== null && (suffixChanged || ipVersion !== row?.ip_version)) {
			if (ipVersion === "ipv4") {
				throw refusal("An IPv6 suffix needs IPv6 or both", "error.ddns-suffix-needs-ipv6");
			}
			if (suffixChanged && !isIpv6Suffix(suffix)) {
				throw refusal(
					`'${suffix}' is not an IPv6 interface id of at most 64 bits`,
					"error.ddns-suffix-invalid",
					{
						suffix,
					},
				);
			}
		}
		Object.assign(values, { target: null, ip_version: ipVersion, ipv6_suffix: suffix });
	}

	const identityChanged = row !== null && (renamed || credentialChanged || zone !== row.zone);
	return { values, credential, identityChanged };
};

const expandOf = (expand) => (expand?.length > 0 ? `[${expand.join(", ")}]` : null);

const internalDdnsRecord = {
	/**
	 * @param   {Access}  access
	 * @param   {{ expand?: string[]|null, query?: string|null }}  [options]
	 * @returns {Promise<Object[]>}
	 */
	getAll: async (access, { expand = null, query = null } = {}) => {
		access.can("certificates:view");
		const rows = visibleRecords(access).orderBy("npmpro_ddns_record.name", "ASC").allowGraph(GRAPH);
		if (typeof query === "string" && query !== "") {
			rows.whereRaw("lower(npmpro_ddns_record.name) like ? escape '!'", [
				`%${query.toLowerCase().replace(/[!%_]/gu, "!$&")}%`,
			]);
		}
		if (expandOf(expand)) rows.withGraphFetched(expandOf(expand));
		return (await rows).map(toPublic);
	},

	/** The row of a record the user may see; 404 otherwise. No permission check (callers do it). */
	rowOf: async (access, id, { expand = null, trx } = {}) => {
		const query = visibleRecords(access, trx).where("npmpro_ddns_record.id", id).allowGraph(GRAPH).first();
		if (expandOf(expand)) query.withGraphFetched(expandOf(expand));
		const row = await query;
		if (!row) throw new errs.ItemNotFoundError(id);
		return row;
	},

	get: async (access, { id, expand = null }) => {
		access.can("certificates:view");
		return toPublic(await internalDdnsRecord.rowOf(access, id, { expand }));
	},

	create: async (access, data) => {
		access.can("certificates:manage");
		const { values, credential } = await resolveSave(access, data, null);
		// under the credential owner's lock, as a credential delete: an insert cannot slip in after its check
		const row = await ownerLock(credential.owner_user_id, () =>
			nameLock("names", async () => {
				// the credential may have been deleted while this waited for the lock
				if (!(await dnsCredentialModel.query().findById(credential.id))) {
					throw new errs.ItemNotFoundError(credential.id);
				}
				await internalDdnsRecord.assertNameFree(values.name);
				return await ddnsRecordModel.query().insertAndFetch({
					...values,
					state: values.enabled ? "pending" : "disabled",
					failures: 0,
				});
			}),
		);
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "ddns-record",
			object_id: row.id,
			meta: auditMeta(row, credential),
		});
		return toPublic(row);
	},

	update: async (access, data) => {
		access.can("certificates:manage");
		const current = await internalDdnsRecord.rowOf(access, data.id);
		// a move to another credential runs under its owner's lock (owner, then record), as a credential delete does
		const movesTo =
			data.dns_credential_id !== undefined && data.dns_credential_id !== current.dns_credential_id
				? await internalDnsCredential.get(access, { id: data.dns_credential_id })
				: null;
		const underOwner = (fn) => (movesTo === null ? fn() : ownerLock(movesTo.owner_user_id, fn));
		const { saved, credential, toggled } = await underOwner(() =>
			recordLock(data.id, () =>
				nameLock("names", async () => {
					// the record may have been changed or deleted while this waited for the locks
					const row = await internalDdnsRecord.rowOf(access, data.id);
					const { values, credential: next, identityChanged } = await resolveSave(access, data, row);
					if (values.name !== row.name) await internalDdnsRecord.assertNameFree(values.name, row.id);
					const configChanged = ["kind", "target", "ip_version", "ipv6_suffix", "ttl"].some(
						(key) => values[key] !== row[key],
					);
					const patch = { ...values };
					const turnedOn = values.enabled && !row.enabled;
					if (!values.enabled) patch.state = "disabled";
					else if (identityChanged || configChanged || turnedOn) patch.state = "pending";
					if (identityChanged) Object.assign(patch, { meta: null });
					// the addresses and the check time belong to the old name or kind
					if (identityChanged || values.kind !== row.kind) {
						Object.assign(patch, { last_ipv4: null, last_ipv6: null, last_checked_on: null });
					}
					if (patch.state === "pending") {
						const { error_i18n: _key, error_values: _values, ...rest } = row.meta ?? {};
						Object.assign(patch, { failures: 0, next_try_on: null, error: null });
						if (!identityChanged) patch.meta = rest;
					}
					const done = await ddnsRecordModel.query().patchAndFetchById(row.id, patch);
					return { saved: done, credential: next, toggled: row.enabled !== done.enabled };
				}),
			),
		);
		const meta = auditMeta(saved, credential);
		let action = "updated";
		if (toggled && Object.keys(data).filter((key) => key !== "id" && key !== "enabled").length === 0) {
			action = saved.enabled ? "enabled" : "disabled";
		}
		await internalAuditLog.add(access, {
			action,
			object_type: "ddns-record",
			object_id: saved.id,
			meta,
		});
		return toPublic(await internalDdnsRecord.rowOf(access, saved.id, { expand: data.expand }));
	},

	delete: async (access, { id }) => {
		access.can("certificates:manage");
		const row = await internalDdnsRecord.rowOf(access, id);
		const credential = await credentialOf(row);
		await recordLock(id, async () => {
			// SQLite does not run the foreign key's cascade: the history goes in code, in the same transaction
			await ddnsRecordModel.transaction(async (trx) => {
				await ddnsHistoryModel.query(trx).where("ddns_record_id", id).delete();
				const gone = await ddnsRecordModel.query(trx).deleteById(id);
				if (gone === 0) throw new errs.ItemNotFoundError(id);
			});
		});
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "ddns-record",
			object_id: id,
			meta: auditMeta(row, credential),
		});
		return toPublic(row);
	},

	/** @returns {Promise<Object[]>}  the history of a record, newest first */
	history: async (access, { id }) => {
		access.can("certificates:view");
		await internalDdnsRecord.rowOf(access, id);
		return await ddnsHistoryModel
			.query()
			.where("ddns_record_id", id)
			.orderBy("id", "DESC")
			.limit(HISTORY_SHOWN)
			.select("id", "created_on", "kind", "ip_version", "old_ip", "new_ip", "message");
	},

	/** @returns {Promise<number[]>} the ids of the enabled records the user can see */
	enabledIds: async (access) =>
		(await visibleRecords(access).where("npmpro_ddns_record.enabled", true).select("npmpro_ddns_record.id")).map(
			(row) => row.id,
		),

	/** The number of enabled records the user can see */
	countEnabled: async (access) => {
		const [{ count }] = await visibleRecords(access)
			.where("npmpro_ddns_record.enabled", true)
			.count({ count: "*" });
		return Number(count);
	},

	assertNameFree: async (name, exceptId) => {
		const query = ddnsRecordModel.query().where("name", name);
		if (exceptId) query.whereNot("id", exceptId);
		if ((await query.resultSize()) > 0) {
			throw refusal(`A dynamic DNS record for ${name} already exists`, "error.ddns-name-taken", { name });
		}
	},
};

const plain = (row) => {
	if (!row) return null;
	const record = { ...row };
	for (const key of TIME_KEYS) record[key] = fromDbTime(row[key]);
	return record;
};

/** What the engine reads and writes; no access checks */
const ddnsStore = {
	enabledRecords: async () => (await ddnsRecordModel.query().where("enabled", true).orderBy("id")).map(plain),

	getRecord: async (id) => plain(await ddnsRecordModel.query().findById(id)),

	saveRecord: async (id, patch) => {
		const next = { ...patch };
		for (const key of TIME_KEYS) if (key in next) next[key] = toDbTime(next[key]);
		await ddnsRecordModel.query().patch(next).where("id", id);
	},

	addHistory: async (id, row) => {
		await ddnsHistoryModel.query().insert({ ddns_record_id: id, ...row });
	},

	// the newest `keep` rows stay: everything at or below the id of the row after them goes
	trimHistory: async (id, keep) => {
		const [edge] = await ddnsHistoryModel
			.query()
			.select("id")
			.where("ddns_record_id", id)
			.orderBy("id", "DESC")
			.offset(keep)
			.limit(1);
		if (edge) await ddnsHistoryModel.query().where("ddns_record_id", id).where("id", "<=", edge.id).delete();
	},

	/** @returns {Promise<{ fields: Object, secrets: String[] }>}  the opened credential, in memory for one run */
	openCredential: async (record) => {
		const row = await credentialOf(record);
		if (row === null) throw new Error("The DNS credential of this record is gone");
		const fields = credentialFields(internalDnsCredential.openValues(row));
		return { fields, secrets: secretValuesOf(row.provider, fields) };
	},
};

export { ddnsStore, normalizeRecordName, recordLock };
export default internalDdnsRecord;
