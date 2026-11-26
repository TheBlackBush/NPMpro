import { refusalOf, secretsOfUrl } from "../lib/ddns/custom-url.js";
import { fromDbTime, toDbTime } from "../lib/ddns/db-time.js";
import { EngineFailure } from "../lib/ddns/engine-failure.js";
import { isIpv6Suffix } from "../lib/ddns/ipv6.js";
import { isPreset, PRESET_FIELDS, presetSecrets } from "../lib/ddns/presets.js";
import { providerById, updaterFor } from "../lib/ddns/providers/index.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { ownerLock } from "../lib/dns-domain-lock.js";
import { bareName, coveringZone } from "../lib/dns-domain-match.js";
import { normalizeDomainName } from "../lib/dns-domain-name.js";
import errs from "../lib/error.js";
import { createKeyedLock } from "../lib/keyed-lock.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { global as logger } from "../logger.js";
import ddnsHistoryModel from "../models/ddns_history.js";
import ddnsRecordModel from "../models/ddns_record.js";
import deadHostModel from "../models/dead_host.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import internalAuditLog from "./audit-log.js";
import internalDnsCredential from "./dns-credential.js";
import { notify } from "./notify.js";

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

const CUSTOM = "custom";
// the restore marks of a record whose sealed details did not come along
const MISSING_KEYS = new Set(["error.ddns-custom-url-missing", "error.ddns-secret-missing"]);
const CUSTOM_LABEL = "Custom HTTP";

/** What a custom record's sealed secret holds: { url, method, expect }; null when none or not readable */
const openCustom = (secret) => {
	if (typeof secret !== "string" || secret === "") return null;
	try {
		const opened = defaultSecretBox.decrypt(secret);
		return typeof opened?.url === "string" && opened.url !== "" ? opened : null;
	} catch {
		return null;
	}
};

/** What a preset record's sealed secret holds ({ domain?, username?, password }); null when none or not readable */
const openPreset = (secret) => {
	if (typeof secret !== "string" || secret === "") return null;
	try {
		const opened = defaultSecretBox.decrypt(secret);
		return typeof opened?.password === "string" && opened.password !== "" ? opened : null;
	} catch {
		return null;
	}
};

// Check now of a user who is no administrator does not call a custom URL
const customOnlyForAdmin = (access, query) =>
	access.isAdmin ? query : query.whereNot("npmpro_ddns_record.provider", CUSTOM);

const iso = (value) => fromDbTime(value)?.toISOString() ?? null;

// the engine keeps the flag per record type (proxied_a, proxied_aaaa, proxied_cname): true when any is proxied
const proxiedOf = (meta) => {
	const flags = ["proxied_a", "proxied_aaaa", "proxied_cname", "proxied"]
		.map((key) => meta?.[key])
		.filter((value) => typeof value === "boolean");
	return flags.length === 0 ? null : flags.includes(true);
};

// the host tables a record made through a host's DNS option can belong to (host_type)
const HOST_MODELS = {
	proxy_host: proxyHostModel,
	redirection_host: redirectionHostModel,
	dead_host: deadHostModel,
};

const HOST_SECTIONS = { proxy_host: "proxy_hosts", redirection_host: "redirection_hosts", dead_host: "dead_hosts" };

const hostKey = (hostType, hostId) => `${hostType}:${hostId}`;

/** A record made through a host's DNS option: it belongs to that host and changes only through it */
const isManaged = (row) => typeof row?.host_type === "string" && row.host_type !== "";

/** A managed record whose delete at the provider failed: the row stays until it is deleted again or forgotten */
const isOrphan = (row) => isManaged(row) && row.meta?.orphan === true;

/**
 * The label of each host the rows belong to (its first name), by `host_type:host_id`; a host that is gone has none
 *
 * @param   {Object[]}  rows
 * @param   {Access}  [access]  the user: a host type they may not view, or a host they may not see, has no label
 * @returns {Promise<Map<String, String>>}
 */
const hostLabelsOf = async (rows, access) => {
	const labels = new Map();
	for (const [hostType, model] of Object.entries(HOST_MODELS)) {
		// the label is a host's name: only for a user who may view that host type, and only the hosts they may see
		if (access && access.level(HOST_SECTIONS[hostType]) === "hidden") continue;
		const ids = [...new Set(rows.filter((row) => row.host_type === hostType).map((row) => row.host_id))];
		if (ids.length === 0) continue;
		const hosts = model.query().whereIn("id", ids).select("id", "domain_names");
		if (access && access.visibility !== "all") hosts.where("owner_user_id", access.token.getUserId(1));
		for (const host of await hosts) {
			const first = Array.isArray(host.domain_names) ? host.domain_names[0] : null;
			if (typeof first === "string") labels.set(hostKey(hostType, host.id), first);
		}
	}
	return labels;
};

/**
 * The API form of a row: no meta or secret, ISO times, the engine's translatable error and note, and the proxied flag
 *
 * @param   {Object}  row
 * @param   {Access}  access  a custom record's method and expected text are shown to administrators only
 * @param   {Map<String, String>}  [labels]  the host labels (hostLabelsOf) of managed rows
 * @returns {Object}
 */
const toPublic = (row, access, labels) => {
	const { meta, ...json } = row.toJSON();
	for (const key of TIME_KEYS) json[key] = iso(row[key]);
	// an alias follows no address: the column keeps its NOT NULL default, the answer says none
	if (json.kind === "alias") Object.assign(json, { ip_version: null, ipv6_suffix: null });
	// the URL itself never leaves: only whether one is stored, and (to administrators) the method and expected text
	const custom = row.provider === CUSTOM ? openCustom(row.secret) : null;
	const callShown = access?.isAdmin === true;
	// a preset's password and user name never leave either: only whether they are stored, and the domain (Namecheap)
	const preset = isPreset(row.provider) ? openPreset(row.secret) : null;
	return {
		...json,
		...(row.provider === CUSTOM
			? {
					url_set: custom !== null,
					method: callShown ? (custom?.method ?? null) : null,
					expect: callShown ? (custom?.expect ?? null) : null,
				}
			: {}),
		...(isPreset(row.provider) ? { secret_set: preset !== null, domain: preset?.domain ?? null } : {}),
		error_i18n: meta?.error_i18n ?? null,
		error_values: meta?.error_values ?? null,
		note_i18n: meta?.note_i18n ?? null,
		// a provider refused the account: no automatic try until the user acts
		stopped: meta?.stopped === true,
		proxied: proxiedOf(meta),
		host_type: row.host_type ?? null,
		host_id: row.host_id ?? null,
		origin: row.origin ?? null,
		host_label: isManaged(row) ? (labels?.get(hostKey(row.host_type, row.host_id)) ?? null) : null,
		orphan: isOrphan(row),
	};
};

/** toPublic of one row, with its host label */
const publicOf = async (row, access) => toPublic(row, access, await hostLabelsOf([row], access));

/** A user's change or delete of a record that belongs to a host: refused, it changes only through the host */
const assertNotManaged = (row) => {
	if (isManaged(row)) {
		throw refusal("This record belongs to a host: change it in the host's DNS card", "error.ddns-managed-by-host");
	}
};

const auditMeta = (row, credential) => ({
	name: row.name,
	provider: row.provider,
	kind: row.kind,
	...(row.target ? { target: row.target } : {}),
	...(credential ? { dns_credential_id: credential.id, credential_name: credential.name } : {}),
	...(isManaged(row) ? { host_type: row.host_type, host_id: row.host_id, origin: row.origin ?? null } : {}),
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

const suffixOf = (data, row) => {
	const input = data.ipv6_suffix !== undefined ? data.ipv6_suffix : (row?.ipv6_suffix ?? null);
	return typeof input === "string" && input.trim() !== "" ? input.trim() : null;
};

/**
 * The address-record values of a save, shared by both paths: no target, the IP version and the IPv6 suffix, the
 * suffix checked only when it (or the kind) changed
 */
const addressValues = ({ data, row, kind, suffix }) => {
	const kindChanged = row === null || kind !== row.kind;
	if (typeof data.target === "string" && data.target.trim() !== "") {
		throw refusal("An address record takes no target", "error.ddns-address-no-target");
	}
	const ipVersion = data.ip_version ?? (kindChanged ? "ipv4" : row.ip_version);
	const suffixChanged = suffix !== (kindChanged ? null : (row?.ipv6_suffix ?? null));
	if (suffix !== null && (suffixChanged || ipVersion !== row?.ip_version)) {
		if (ipVersion === "ipv4") throw refusal("An IPv6 suffix needs IPv6 or both", "error.ddns-suffix-needs-ipv6");
		if (suffixChanged && !isIpv6Suffix(suffix)) {
			throw refusal(`'${suffix}' is not an IPv6 interface id of at most 64 bits`, "error.ddns-suffix-invalid", {
				suffix,
			});
		}
	}
	return { target: null, ip_version: ipVersion, ipv6_suffix: suffix };
};

// <subdomain>.<zone> with one subdomain label
const zonelessNameOk = (name, zone) => name.endsWith(`.${zone}`) && !name.slice(0, -(zone.length + 1)).includes(".");

/**
 * The save of a record of a zoneless provider: the zone is the provider's own, the name one label under it, the
 * record an address record without a TTL
 */
const resolveZoneless = ({ updater, credential, credentialChanged, data, row, name, renamed }) => {
	if ((renamed || credentialChanged) && !zonelessNameOk(name, updater.zone)) {
		throw refusal(`${updater.label} records are named <subdomain>.${updater.zone}`, "error.ddns-zoneless-name", {
			provider: updater.label,
			zone: updater.zone,
		});
	}
	const kind = data.kind ?? row?.kind ?? "address";
	if (kind === "alias" && (row === null || kind !== row.kind || credentialChanged)) {
		throw refusal(`${updater.label} does not allow alias (CNAME) records`, "error.ddns-alias-unsupported", {
			provider: updater.label,
		});
	}
	const ttl = data.ttl !== undefined ? data.ttl : (row?.ttl ?? null);
	if (ttl !== null && (row === null || ttl !== row.ttl || credentialChanged)) {
		throw refusal(`${updater.label} takes no TTL`, "error.ddns-ttl-unsupported", { provider: updater.label });
	}
	const address = addressValues({ data, row, kind, suffix: suffixOf(data, row) });
	return {
		values: {
			owner_user_id: credential.owner_user_id,
			dns_credential_id: credential.id,
			provider: updater.id,
			name,
			zone: updater.zone,
			kind,
			ttl,
			enabled: data.enabled ?? row?.enabled ?? true,
			...address,
		},
		credential,
		identityChanged: row !== null && (renamed || credentialChanged || updater.zone !== row.zone),
	};
};

/**
 * The save of a custom HTTP record: no credential and no zone, the name is the host whose DNS answer the engine
 * compares, an address record without a TTL; the URL, the method and the expected text are sealed in `secret`.
 */
const resolveCustom = async (access, data, row) => {
	if (data.dns_credential_id !== undefined && data.dns_credential_id !== null) {
		throw refusal("The custom provider takes no DNS credential", "error.ddns-custom-no-credential");
	}
	const nameChanged = row === null || (data.name !== undefined && data.name !== row.name);
	const name = nameChanged ? normalizeRecordName(data.name) : row.name;
	const renamed = row === null || name !== row.name;
	if (renamed && isWildcard(name)) {
		throw refusal(`${CUSTOM_LABEL} does not support wildcard records`, "error.ddns-wildcard-unsupported", {
			provider: CUSTOM_LABEL,
		});
	}
	const kind = data.kind ?? row?.kind ?? "address";
	if (kind === "alias") {
		throw refusal(`${CUSTOM_LABEL} does not allow alias (CNAME) records`, "error.ddns-alias-unsupported", {
			provider: CUSTOM_LABEL,
		});
	}
	const ttl = data.ttl !== undefined ? data.ttl : (row?.ttl ?? null);
	if (ttl !== null) {
		throw refusal(`${CUSTOM_LABEL} takes no TTL`, "error.ddns-ttl-unsupported", { provider: CUSTOM_LABEL });
	}
	const stored = openCustom(row?.secret);
	const typed = typeof data.url === "string" && data.url.trim() !== "" ? data.url.trim() : null;
	if (typed !== null) {
		const key = await refusalOf(typed);
		if (key !== null) throw refusal("The URL is not accepted", key);
	}
	const url = typed ?? stored?.url ?? null;
	const enabled = data.enabled ?? row?.enabled ?? true;
	if (url === null && (row === null || enabled)) {
		throw refusal("Enter the URL", "error.ddns-custom-url-required");
	}
	const expectInput = data.expect !== undefined ? data.expect : (stored?.expect ?? null);
	const expect = typeof expectInput === "string" && expectInput.trim() !== "" ? expectInput.trim() : null;
	const method = data.method ?? stored?.method ?? "GET";
	const address = addressValues({ data, row, kind, suffix: suffixOf(data, row) });
	const values = {
		owner_user_id: row?.owner_user_id ?? access.token.getUserId(1),
		dns_credential_id: null,
		provider: CUSTOM,
		name,
		zone: "",
		kind,
		ttl,
		enabled,
		...address,
	};
	const sealedAgain =
		url !== null &&
		(typed !== null ||
			stored === null ||
			method !== (stored.method ?? "GET") ||
			expect !== (stored.expect ?? null));
	if (sealedAgain) values.secret = defaultSecretBox.encrypt({ url, method, expect });
	return { values, credential: null, identityChanged: row !== null && renamed };
};

const PRESET_FIELD_NAMES = ["username", "password", "domain"];

/** The typed text of a preset field, trimmed; null when none was typed */
const typedField = (data, key) => (typeof data[key] === "string" && data[key].trim() !== "" ? data[key].trim() : null);

/**
 * The save of an update-URL preset record (Namecheap, No-IP, Dynu): no credential, no zone, an address record without
 * a TTL, no wildcard; the account details are sealed in `secret` and an empty value keeps the stored one.
 */
const resolvePreset = (access, data, row, updater) => {
	if (data.dns_credential_id !== undefined && data.dns_credential_id !== null) {
		throw refusal(`${updater.label} takes no DNS credential`, "error.ddns-preset-no-credential", {
			provider: updater.label,
		});
	}
	if (data.url !== undefined || data.method !== undefined || data.expect !== undefined) {
		throw refusal(
			"Only the custom provider takes a URL, a method or an expected text",
			"error.ddns-custom-fields-only",
		);
	}
	const wanted = PRESET_FIELDS[updater.id];
	const refused = PRESET_FIELD_NAMES.find((key) => !wanted.includes(key) && typedField(data, key) !== null);
	if (refused !== undefined) {
		throw refusal(`${updater.label} takes no ${refused}`, "error.ddns-preset-field", {
			field: refused,
			provider: updater.label,
		});
	}
	const nameChanged = row === null || (data.name !== undefined && data.name !== row.name);
	const name = nameChanged ? normalizeRecordName(data.name) : row.name;
	const renamed = row === null || name !== row.name;
	if (renamed && isWildcard(name)) {
		throw refusal(`${updater.label} does not support wildcard records`, "error.ddns-wildcard-unsupported", {
			provider: updater.label,
		});
	}
	const kind = data.kind ?? row?.kind ?? "address";
	if (kind === "alias") {
		throw refusal(`${updater.label} does not allow alias (CNAME) records`, "error.ddns-alias-unsupported", {
			provider: updater.label,
		});
	}
	const ttl = data.ttl !== undefined ? data.ttl : (row?.ttl ?? null);
	if (ttl !== null) {
		throw refusal(`${updater.label} takes no TTL`, "error.ddns-ttl-unsupported", { provider: updater.label });
	}
	const stored = openPreset(row?.secret);
	const fields = {};
	let changed = stored === null;
	for (const key of wanted) {
		const typed = typedField(data, key);
		fields[key] = typed ?? stored?.[key] ?? null;
		if (typed !== null && typed !== (stored?.[key] ?? null)) changed = true;
	}
	if (typeof fields.domain === "string") {
		const done = normalizeDomainName(fields.domain);
		if (done.error) {
			throw refusal(`'${fields.domain}' is not a valid domain`, "error.ddns-preset-domain-invalid", {
				domain: fields.domain,
			});
		}
		fields.domain = done.name;
	}
	const enabled = data.enabled ?? row?.enabled ?? true;
	const missing = wanted.some((key) => fields[key] === null);
	// a record without saved details (a restore without secrets) takes all of them at once: a part would be lost
	if (row !== null && stored === null && missing && wanted.some((key) => typedField(data, key) !== null)) {
		throw refusal(
			`The record has no saved account details: enter all of them for ${updater.label}`,
			"error.ddns-preset-incomplete",
			{ provider: updater.label },
		);
	}
	if (missing && (row === null || enabled)) {
		throw refusal(`Enter the account details of ${updater.label}`, "error.ddns-preset-required", {
			provider: updater.label,
		});
	}
	if (typeof fields.domain === "string" && name !== fields.domain && !name.endsWith(`.${fields.domain}`)) {
		throw refusal(`${name} is not inside the domain ${fields.domain}`, "error.ddns-zone-mismatch", {
			name,
			zone: fields.domain,
		});
	}
	const address = addressValues({ data, row, kind, suffix: suffixOf(data, row) });
	if (updater.ipv6 === false && address.ip_version !== "ipv4") {
		throw refusal(`${updater.label} supports IPv4 only`, "error.ddns-ipv4-only", { provider: updater.label });
	}
	if (updater.ipv6Alone === false && address.ip_version === "ipv6") {
		throw refusal(`${updater.label} does not take a record of IPv6 alone`, "error.ddns-ipv6-alone-unsupported", {
			provider: updater.label,
		});
	}
	const values = {
		owner_user_id: row?.owner_user_id ?? access.token.getUserId(1),
		dns_credential_id: null,
		provider: updater.id,
		name,
		zone: "",
		kind,
		ttl,
		enabled,
		...address,
	};
	if (changed && !missing) values.secret = defaultSecretBox.encrypt(fields);
	// the domain is part of the identity of the call: a changed one starts the record over
	const domainChanged = (fields.domain ?? null) !== (stored?.domain ?? null);
	return { values, credential: null, identityChanged: row !== null && (renamed || domainChanged) };
};

/** The custom provider is for administrators: creating, changing, deleting and updating such a record */
const assertCustomAdmin = (access) => {
	if (!access.isAdmin) throw new errs.PermissionError("Only an administrator may manage a custom HTTP record");
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
	const current = row?.provider ?? data.provider;
	if (isPreset(current)) {
		if (data.provider !== undefined && data.provider !== null && data.provider !== current) {
			throw refusal(`The record's provider is ${current}, not ${data.provider}`, "error.ddns-provider-mismatch", {
				provider: String(data.provider),
			});
		}
		return resolvePreset(access, data, row, providerById(current));
	}
	const isCustom = current === CUSTOM;
	if (isCustom) {
		if (data.provider !== undefined && data.provider !== null && data.provider !== CUSTOM) {
			throw refusal(`The record's provider is ${CUSTOM}, not ${data.provider}`, "error.ddns-provider-mismatch", {
				provider: String(data.provider),
			});
		}
		return await resolveCustom(access, data, row);
	}
	if (data.provider === CUSTOM) {
		throw refusal(`The record's provider is ${row.provider}, not ${CUSTOM}`, "error.ddns-provider-mismatch", {
			provider: CUSTOM,
		});
	}
	if (
		data.url !== undefined ||
		data.method !== undefined ||
		data.expect !== undefined ||
		PRESET_FIELD_NAMES.some((key) => data[key] !== undefined)
	) {
		throw refusal(
			"Only the custom provider takes a URL, a method or an expected text",
			"error.ddns-custom-fields-only",
		);
	}
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

	// a zoneless provider (DuckDNS) has one fixed zone and takes the name as <subdomain>.<zone>; no domain of the
	// credential is looked up and none needs adding
	if (updater.zoneless === true)
		return resolveZoneless({ updater, credential, credentialChanged, data, row, name, renamed });

	let zone = row?.zone;
	const typedZone = data.zone !== undefined && data.zone !== null && data.zone !== "" ? data.zone : null;
	if (row === null || renamed || credentialChanged) zone = await zoneFor(credential, name, typedZone);
	else if (typedZone !== null && typedZone !== row.zone) zone = typedZoneFor(name, typedZone);

	// OVH spells the apex in a way its documentation does not confirm: such a provider has no apex records
	if (
		updater.apex === false &&
		name === zone &&
		(row === null || renamed || credentialChanged || zone !== row.zone)
	) {
		throw refusal(`${updater.label} does not allow records at the zone apex`, "error.ddns-apex-unsupported", {
			provider: updater.label,
			name,
		});
	}

	const kind = data.kind ?? row?.kind ?? "address";
	const kindChanged = row === null || kind !== row.kind;
	if (kind === "alias" && updater.aliases === false && (kindChanged || credentialChanged)) {
		throw refusal(`${updater.label} does not allow alias (CNAME) records`, "error.ddns-alias-unsupported", {
			provider: updater.label,
		});
	}
	const ttl = data.ttl !== undefined ? data.ttl : (row?.ttl ?? null);
	if (
		ttl !== null &&
		Number.isInteger(updater.minTtl) &&
		ttl < updater.minTtl &&
		(row === null || ttl !== row.ttl || credentialChanged)
	) {
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

	const suffix = suffixOf(data, row);
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
		Object.assign(values, addressValues({ data, row, kind, suffix }));
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
		const found = await rows;
		const labels = await hostLabelsOf(found, access);
		return found.map((row) => toPublic(row, access, labels));
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
		return await publicOf(await internalDdnsRecord.rowOf(access, id, { expand }), access);
	},

	create: async (access, data) => {
		access.can("certificates:manage");
		if (data.provider === CUSTOM) assertCustomAdmin(access);
		const { values, credential } = await resolveSave(access, data, null);
		// under the credential owner's lock, as a credential delete: an insert cannot slip in after its check
		const row = await ownerLock(values.owner_user_id, () =>
			nameLock("names", async () => {
				// the credential may have been deleted while this waited for the lock
				if (credential && !(await dnsCredentialModel.query().findById(credential.id))) {
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
		return toPublic(row, access);
	},

	update: async (access, data) => {
		access.can("certificates:manage");
		const current = await internalDdnsRecord.rowOf(access, data.id);
		assertNotManaged(current);
		if (current.provider === CUSTOM) assertCustomAdmin(access);
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
					assertNotManaged(row);
					const { values, credential: next, identityChanged } = await resolveSave(access, data, row);
					if (values.name !== row.name) await internalDdnsRecord.assertNameFree(values.name, row.id);
					const configChanged =
						"secret" in values ||
						["kind", "target", "ip_version", "ipv6_suffix", "ttl"].some((key) => values[key] !== row[key]);
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
						// a save with a change, or enabling, also ends a stop after a provider's refusal
						const {
							error_i18n: _key,
							error_values: _values,
							note_i18n: _note,
							stopped: _stopped,
							...rest
						} = row.meta ?? {};
						Object.assign(patch, { failures: 0, next_try_on: null, error: null });
						if (!identityChanged) patch.meta = rest;
					}
					// a new URL answers "Enter the URL again" of a restore (enabling stays the user's choice)
					if ("secret" in values && !("meta" in patch) && MISSING_KEYS.has(row.meta?.error_i18n)) {
						const { error_i18n: _key, error_values: _values, ...rest } = row.meta;
						patch.meta = rest;
					}
					const done = await ddnsRecordModel.query().patchAndFetchById(row.id, patch);
					return { saved: done, credential: next, toggled: row.enabled !== done.enabled };
				}),
			),
		);
		// a disabled record is no problem any more: its states go without an event, enabling records them again
		if (!saved.enabled) await clearRecordStates(saved.id);
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
		return await publicOf(await internalDdnsRecord.rowOf(access, saved.id, { expand: data.expand }), access);
	},

	/** Deletes a record; a host's record only when it is an orphan ("Forget": the row goes, the provider is not called) */
	delete: async (access, { id }) => {
		access.can("certificates:manage");
		const row = await internalDdnsRecord.rowOf(access, id);
		if (!isOrphan(row)) assertNotManaged(row);
		if (row.provider === CUSTOM) assertCustomAdmin(access);
		const credential = await credentialOf(row);
		await recordLock(id, async () => {
			// a host's record may have stopped being an orphan while this waited for the lock
			const current = await ddnsRecordModel.query().findById(id);
			if (!current) throw new errs.ItemNotFoundError(id);
			if (!isOrphan(current)) assertNotManaged(current);
			await deleteRow(id);
		});
		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "ddns-record",
			object_id: id,
			meta: auditMeta(row, credential),
		});
		return await publicOf(row, access);
	},

	/**
	 * Adopt and update of a host's record whose name already had another address: the updater owns it from now on
	 * (the old value goes into the history). The host record service (host-dns-record.js) does the work.
	 */
	adopt: async (access, { id }) => (await hostRecords()).adopt(access, { id }),

	/** Leave alone of a host's record whose name already had another record: the row goes, nothing is written */
	leave: async (access, { id }) => (await hostRecords()).leave(access, { id }),

	/** Delete at the provider again, for an orphan (a host's record whose provider delete failed) */
	removeAtProvider: async (access, { id }) => (await hostRecords()).removeAtProvider(access, { id }),

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
		(
			await customOnlyForAdmin(access, visibleRecords(access).where("npmpro_ddns_record.enabled", true)).select(
				"npmpro_ddns_record.id",
			)
		).map((row) => row.id),

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

// loaded on use: the host record service imports this file
const hostRecords = async () => (await import("./host-dns-record.js")).default;

// a deleted or disabled record has no notification state left; the layer never fails the delete or the save
const clearRecordStates = async (id) => {
	try {
		await notify.clearState("ddns.record_failed", String(id));
		await notify.clearState("ddns.record_stopped", String(id));
	} catch (error) {
		logger.warn(
			`Dynamic DNS record ${id}: could not clear its notification states: ${String(error?.message ?? error).slice(0, 200)}`,
		);
	}
};

/** Deletes a row and its history (SQLite does not run the foreign key's cascade: the history goes in code) */
const deleteRow = async (id) => {
	await ddnsRecordModel.transaction(async (trx) => {
		await ddnsHistoryModel.query(trx).where("ddns_record_id", id).delete();
		const gone = await ddnsRecordModel.query(trx).deleteById(id);
		if (gone === 0) throw new errs.ItemNotFoundError(id);
	});
	await clearRecordStates(id);
};

/**
 * The rows of the host record option (host-dns-record.js); no access checks. A row is inserted under its credential
 * owner's lock and the name lock, as a record create; a change or delete runs under the record lock, which the caller
 * holds (recordLock).
 */
const managedRows = {
	/** @returns {Promise<Object[]>}  the rows of one host */
	ofHost: async (hostType, hostId) =>
		(await ddnsRecordModel.query().where({ host_type: hostType, host_id: hostId }).orderBy("id")).map(plain),

	/** @returns {Promise<Object[]>}  the rows of several hosts of one type, in one query */
	ofHosts: async (hostType, hostIds) =>
		hostIds.length === 0
			? []
			: (
					await ddnsRecordModel.query().where("host_type", hostType).whereIn("host_id", hostIds).orderBy("id")
				).map(plain),

	/** @returns {Promise<Object[]>}  every row of one host type (the start's check for rows of deleted hosts) */
	ofType: async (hostType) => (await ddnsRecordModel.query().where("host_type", hostType).orderBy("id")).map(plain),

	get: async (id) => plain(await ddnsRecordModel.query().findById(id)),

	/** The record that holds a name, whoever it belongs to; null when none */
	byName: async (name) => plain(await ddnsRecordModel.query().where("name", name).first()),

	/**
	 * @param   {Object}  values  the row; its credential must still exist and its name must be free
	 * @returns {Promise<Object>}  the row
	 * @throws  {errs.ValidationError}  error.ddns-name-taken
	 * @throws  {errs.ItemNotFoundError}  the credential is gone
	 */
	insert: (values) =>
		ownerLock(values.owner_user_id, () =>
			nameLock("names", async () => {
				if (!(await dnsCredentialModel.query().findById(values.dns_credential_id))) {
					throw new errs.ItemNotFoundError(values.dns_credential_id);
				}
				await internalDdnsRecord.assertNameFree(values.name);
				const row = { ...values };
				for (const key of TIME_KEYS) if (key in row) row[key] = toDbTime(row[key]);
				return plain(await ddnsRecordModel.query().insertAndFetch(row));
			}),
		),

	patch: (id, patch) => ddnsStore.saveRecord(id, patch),

	remove: (id) => deleteRow(id),
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
		// a row paused with its host (or set aside) has no states left, as a record the user disables
		if (patch.enabled === false) await clearRecordStates(id);
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
		// a custom record has no credential: its sealed URL, method and expected text are the fields
		if (record.provider === CUSTOM) {
			const custom = openCustom(record.secret);
			return { fields: custom ?? {}, secrets: custom === null ? [] : secretsOfUrl(custom.url) };
		}
		if (isPreset(record.provider)) {
			const preset = openPreset(record.secret);
			if (preset === null) throw new EngineFailure("Enter the password again", "error.ddns-secret-missing");
			return { fields: preset, secrets: presetSecrets(preset) };
		}
		const row = await credentialOf(record);
		if (!row) throw new Error("The DNS credential of this record is gone");
		const fields = credentialFields(internalDnsCredential.openValues(row));
		return { fields, secrets: secretValuesOf(row.provider, fields) };
	},
};

export { auditMeta, ddnsStore, HOST_MODELS, isManaged, isOrphan, managedRows, normalizeRecordName, recordLock };
export default internalDdnsRecord;
