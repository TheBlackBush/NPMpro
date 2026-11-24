// The rules of the Dynamic DNS record window and the state of a record in the list. Every rule is the twin of
// backend/internal/ddns-record.js (resolveSave) and backend/lib/ddns/ipv6.js: a stored value passes a save that keeps
// it, and the checks run on new or changed values only. Pure.

import { decamelizeKeys } from "../api/backend/caseConvert.js";
import { normalizeDnsDomain } from "./DnsDomainForms.js";
import { coveringZone } from "./DnsDomainMatch.js";

const GROUPS = 8;
const HEX_GROUP = /^[0-9a-f]{1,4}$/iu;
const GROUP_SIZE = 65_536n;
const HALF = 2n ** 64n;
// the schema's floor (DigitalOcean's 30); each provider's own minimum comes with GET /nginx/ddns/providers (min_ttl)
const MIN_TTL = 30;
const MAX_TTL = 86_400;
const WILDCARD_PREFIX = "*.";
const TRAILING_DOT = /\.$/u;
const WILDCARD_LEAD = /^\*\./u;
// the names of the IP versions, as the record list shows them (not translated: they are protocol names)
const IP_VERSIONS = { ipv4: "IPv4", ipv6: "IPv6", both: "IPv4 + IPv6" };
const DAY_MS = 24 * 60 * 60 * 1000;
const WHOLE_NUMBER = /^\d+$/u;

/** An IPv6 address (no zone, no embedded IPv4) as one number, or null when it is not one */
const toNumber = (text) => {
	if (typeof text !== "string" || text.length === 0 || text.length > 45) return null;
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part) => (part === "" ? [] : part.split(":"));
	const head = parse(halves[0]);
	const tail = halves.length === 2 ? parse(halves[1]) : [];
	const missing = GROUPS - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
	if (groups.length !== GROUPS || !groups.every((group) => HEX_GROUP.test(group))) return null;
	return groups.reduce((total, group) => total * GROUP_SIZE + BigInt(`0x${group}`), 0n);
};

/**
 * Whether text is an IPv6 interface id such as `::1` or `::a:b:c:d`: a valid IPv6 address (not zero) with at most
 * 64 bits set. The twin of isIpv6Suffix in backend/lib/ddns/ipv6.js (same cases).
 *
 * @param   {unknown} text
 * @returns {boolean}
 */
const isIpv6Suffix = (text) => {
	const value = toNumber(text);
	return value !== null && value > 0n && value < HALF;
};

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";
const trimmed = (value) => (isBlank(value) ? "" : String(value).trim());

/**
 * A record name as the backend keeps it: lower case, punycode, no trailing dot, a leading "*." kept
 *
 * @param   {unknown} input
 * @returns {{ name: string, wildcard: boolean } | { error: string }}
 */
const normalizeRecordName = (input) => {
	const text = typeof input === "string" ? input.trim() : "";
	const wildcard = text.startsWith(WILDCARD_PREFIX);
	const done = normalizeDnsDomain(wildcard ? text.slice(WILDCARD_PREFIX.length) : text);
	if (done.error) return { error: "error.ddns-name-invalid" };
	return { name: wildcard ? `${WILDCARD_PREFIX}${done.name}` : done.name, wildcard };
};

const bare = (name) => name.replace(WILDCARD_LEAD, "").replace(TRAILING_DOT, "");
const covers = (zone, name) => {
	const host = bare(name);
	return host === zone || host.endsWith(`.${zone}`);
};

/** The zone to suggest for a name: its parent when it has three labels or more (the backend's guess) */
const suggestedZone = (name) => {
	const labels = bare(name).split(".");
	return labels.length > 2 ? labels.slice(1).join(".") : bare(name);
};

/**
 * The longest domain of one credential that covers the name
 *
 * @param   {string}  name
 * @param   {number}  credentialId
 * @param   {Array<{ name: string, credentialId: number, ownerUserId: number }>}  zones  every known domain
 * @returns {string | null}
 */
const zoneFor = (name, credentialId, zones) => {
	const own = (zones ?? []).filter((zone) => zone.credentialId === credentialId);
	if (own.length === 0) return null;
	return coveringZone(name, own, own[0].ownerUserId)?.zone ?? null;
};

/**
 * The provider that writes records for a credential
 *
 * @param   {{ provider?: string } | undefined}  credential
 * @param   {Array<{ credentialProvider: string }>}  providers  GET /nginx/ddns/providers
 */
const providerOf = (credential, providers) =>
	(providers ?? []).find((provider) => provider.credentialProvider === credential?.provider) ?? null;

const problem = (id, values) => (values ? { id, values } : { id });

// <subdomain>.<zone> with one subdomain label
const zonelessNameOk = (name, zone) => name.endsWith(`.${zone}`) && !name.slice(0, -(zone.length + 1)).includes(".");

/** The rules of a record of a zoneless provider: the twin of resolveZoneless in backend/internal/ddns-record.js */
const zonelessErrors = (errors, { values, provider, stored, name, renamed, credentialChanged }) => {
	if (!errors.name && (renamed || credentialChanged) && !zonelessNameOk(name, provider.zone)) {
		errors.name = problem("error.ddns-zoneless-name", { provider: provider.label, zone: provider.zone });
	}
	const kind = values.kind ?? stored?.kind ?? "address";
	if (kind === "alias" && (stored === null || kind !== stored.kind || credentialChanged)) {
		errors.target = problem("error.ddns-alias-unsupported", { provider: provider.label });
	}
	if (!isBlank(values.ttl)) {
		const text = String(values.ttl).trim();
		const ttl = WHOLE_NUMBER.test(text) ? Number(text) : Number.NaN;
		if (stored === null || ttl !== stored.ttl || credentialChanged) {
			errors.ttl = problem("error.ddns-ttl-unsupported", { provider: provider.label });
		}
	}
	const suffix = trimmed(values.ipv6Suffix);
	const ipVersion = values.ipVersion ?? stored?.ipVersion ?? "ipv4";
	const kindChanged = stored === null || kind !== stored.kind;
	if (
		kind !== "alias" &&
		suffix !== "" &&
		(kindChanged || suffix !== trimmed(stored?.ipv6Suffix) || ipVersion !== stored?.ipVersion)
	) {
		if (ipVersion === "ipv4") errors.ipv6Suffix = problem("error.ddns-suffix-needs-ipv6");
		else if (!isIpv6Suffix(suffix)) errors.ipv6Suffix = problem("error.ddns-suffix-invalid", { suffix });
	}
	return errors;
};

/**
 * The errors of a record form, by field. A field without an entry passes.
 *
 * @param   {Object}  values  { name, credentialId, kind ("address" | "alias"), target, ipVersion, ipv6Suffix, ttl,
 *                             zone (typed, optional) }
 * @param   {Object}  context { providers, credentials: [{ id, name, provider, ownerUserId }], zones, stored }
 *                            stored: the saved record (camelCase) on an edit, else null
 * @returns {Object}  { [field]: { id, values? } } with i18n ids (the backend's error.ddns-* keys)
 */
const ddnsRecordValidate = (values, { providers, credentials, zones, stored = null } = {}) => {
	const errors = {};
	const credentialId = values.credentialId ?? stored?.dnsCredentialId;
	const credential = (credentials ?? []).find((entry) => entry.id === credentialId);
	if (!credential) return { credentialId: problem("ddns.error.credential-required") };
	const provider = providerOf(credential, providers);
	if (provider === null) {
		return { credentialId: problem("error.ddns-no-updater", { provider: credential.provider ?? "" }) };
	}

	const rawName = trimmed(values.name);
	const nameUnchanged = stored !== null && rawName === stored.name;
	let name = stored?.name ?? "";
	if (!nameUnchanged) {
		const done = normalizeRecordName(rawName);
		if (done.error) {
			errors.name = problem(done.error, { name: rawName });
			return errors;
		}
		name = done.name;
	}
	const renamed = stored === null || name !== stored.name;
	const credentialChanged = stored === null || credentialId !== stored.dnsCredentialId;

	if ((renamed || credentialChanged) && name.startsWith(WILDCARD_PREFIX) && !provider.wildcards) {
		errors.name = problem("error.ddns-wildcard-unsupported", { provider: provider.label });
	}

	// a zoneless provider (DuckDNS): one fixed zone, the name is <subdomain>.<zone>, no domain to add, no TTL
	if (provider.zoneless === true)
		return zonelessErrors(errors, { values, provider, stored, name, renamed, credentialChanged });

	const typedZone = trimmed(values.zone);
	const checkTyped = () => {
		const done = normalizeDnsDomain(typedZone);
		if (done.error || !covers(done.name, name)) {
			errors.zone = problem("error.ddns-zone-mismatch", { name, zone: typedZone });
		}
	};
	if (!errors.name) {
		if (stored === null || renamed || credentialChanged) {
			if (zoneFor(name, credentialId, zones) === null) {
				if (typedZone === "") {
					errors.zone = problem("error.ddns-no-zone", {
						domain: suggestedZone(name),
						credential: credential.name,
					});
				} else {
					checkTyped();
				}
			}
		} else if (typedZone !== "" && typedZone !== stored.zone) {
			checkTyped();
		}
	}

	// a provider without apex records (OVH): the name may not be the zone itself
	if (provider.apex === false && !errors.name && !errors.zone) {
		const typedDone = typedZone === "" ? null : normalizeDnsDomain(typedZone);
		const known = zoneFor(name, credentialId, zones) ?? (typedDone?.error ? null : (typedDone?.name ?? null));
		const zone = known ?? stored?.zone ?? null;
		if (name === zone && (stored === null || renamed || credentialChanged || zone !== stored.zone)) {
			errors.name = problem("error.ddns-apex-unsupported", { provider: provider.label, name });
		}
	}

	const kind = values.kind ?? stored?.kind ?? "address";
	const kindChanged = stored === null || kind !== stored.kind;
	const target = trimmed(values.target);
	const suffix = trimmed(values.ipv6Suffix);
	if (kind === "alias") {
		const targetChanged = stored === null || kindChanged || target !== trimmed(stored.target);
		if (targetChanged) {
			if (target === "") {
				errors.target = problem("error.ddns-alias-target-required");
			} else {
				const done = normalizeDnsDomain(target);
				if (done.error) errors.target = problem("error.ddns-target-invalid", { target });
				else if (done.name === name) errors.target = problem("error.ddns-alias-self", { name });
			}
		} else if (renamed && target === name) {
			errors.target = problem("error.ddns-alias-self", { name });
		}
		const keepsIp = stored !== null && !kindChanged && stored.ipVersion === values.ipVersion;
		if (values.ipVersion !== undefined && !keepsIp) errors.ipVersion = problem("error.ddns-alias-no-ip");
		if (suffix !== "" && (kindChanged || suffix !== trimmed(stored?.ipv6Suffix))) {
			errors.ipv6Suffix = problem("error.ddns-alias-no-ip");
		}
	} else {
		if (target !== "") errors.target = problem("error.ddns-address-no-target");
		const ipVersion = values.ipVersion ?? (kindChanged ? "ipv4" : stored.ipVersion);
		const storedSuffix = kindChanged ? "" : trimmed(stored?.ipv6Suffix);
		const suffixChanged = suffix !== storedSuffix;
		if (suffix !== "" && (suffixChanged || ipVersion !== stored?.ipVersion)) {
			if (ipVersion === "ipv4") errors.ipv6Suffix = problem("error.ddns-suffix-needs-ipv6");
			else if (suffixChanged && !isIpv6Suffix(suffix)) {
				errors.ipv6Suffix = problem("error.ddns-suffix-invalid", { suffix });
			}
		}
	}

	// the alias target is the field the window shows for an alias, so the refusal sits there
	if (kind === "alias" && provider.aliases === false && (kindChanged || credentialChanged)) {
		errors.target = problem("error.ddns-alias-unsupported", { provider: provider.label });
	}

	if (!isBlank(values.ttl)) {
		const text = String(values.ttl).trim();
		const ttl = WHOLE_NUMBER.test(text) ? Number(text) : Number.NaN;
		const min = minTtlOf(provider);
		const ttlChanged = stored === null || ttl !== stored.ttl || credentialChanged;
		if (!(ttl >= 0 && ttl <= MAX_TTL)) errors.ttl = problem("ddns.error.ttl-range");
		else if (ttl < min && ttlChanged) {
			// a provider without a documented minimum (min_ttl null) only has the schema's floor: no provider message
			errors.ttl = Number.isInteger(provider.minTtl)
				? problem("error.ddns-ttl-min", { min, provider: provider.label })
				: problem("ddns.error.ttl-range");
		}
	}
	return errors;
};

/**
 * The least TTL a provider takes (its min_ttl, never under the schema's floor of 30)
 *
 * @param   {{ minTtl?: number } | null | undefined}  provider  an entry of GET /nginx/ddns/providers
 * @returns {number}
 */
const minTtlOf = (provider) =>
	Number.isInteger(provider?.minTtl) && provider.minTtl > MIN_TTL ? provider.minTtl : MIN_TTL;

/**
 * What the rules of ddnsRecordValidate see: a field the window hides never blocks a save (an address has no target,
 * an alias no IP version or suffix, IPv4 no suffix)
 *
 * @param   {Object}  values  the form values
 * @returns {Object}
 */
const ddnsRulesInput = (values) => {
	if (values.kind === "alias") return { ...values, ipVersion: undefined, ipv6Suffix: "" };
	return { ...values, target: "", ipv6Suffix: values.ipVersion === "ipv4" ? "" : values.ipv6Suffix };
};

/**
 * The request of the record window: an alias sends its target only (on an edit with the suffix cleared, so an
 * address with a suffix can become an alias), an address its IP version and suffix only
 *
 * @param   {Object}  values     the form values
 * @param   {Object | null | undefined}  stored  the saved record on an edit
 * @param   {boolean} zoneTyped  whether no domain of the credential covers the name (the typed zone is sent)
 * @returns {Object}  camelCase body of POST or PUT /nginx/ddns-records
 */
const ddnsRecordPayload = (values, stored, zoneTyped) => {
	const ttl = trimmed(values.ttl);
	const payload = {
		id: stored?.id,
		name: trimmed(values.name),
		dnsCredentialId: values.credentialId,
		kind: values.kind,
		enabled: values.enabled,
	};
	if (ttl !== "") payload.ttl = Number(ttl);
	else if (stored) payload.ttl = null;
	if (zoneTyped && trimmed(values.zone) !== "") payload.zone = trimmed(values.zone);
	if (values.kind === "alias") {
		payload.target = trimmed(values.target);
		if (stored) payload.ipv6Suffix = null;
		return payload;
	}
	payload.ipVersion = values.ipVersion;
	const suffix = trimmed(values.ipv6Suffix);
	if (values.ipVersion !== "ipv4" && suffix !== "") payload.ipv6Suffix = suffix;
	else if (stored) payload.ipv6Suffix = null;
	return payload;
};

const timeOf = (iso) => {
	const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
	return Number.isNaN(time) ? null : time;
};

/**
 * What the list shows for a record
 *
 * @param   {Object}  record  camelCase record of the API
 * @param   {number}  now     milliseconds
 * @returns {{ kind: "ok" | "updated" | "pending" | "failed" | "disabled", at: string | null, nextTry: string | null,
 *             proxied: boolean }}
 *          at: when it was last checked (last changed for "updated"); nextTry: a retry time still ahead
 */
const recordStateOf = (record, now) => {
	const proxied = record.proxied === true;
	if (!record.enabled || record.state === "disabled") return { kind: "disabled", at: null, nextTry: null, proxied };
	const next = timeOf(record.nextTryOn);
	const nextTry = next !== null && next > now ? record.nextTryOn : null;
	if (record.state === "failed") return { kind: "failed", at: record.lastCheckedOn ?? null, nextTry, proxied };
	if (record.state === "pending") return { kind: "pending", at: null, nextTry, proxied };
	const changed = timeOf(record.lastChangedOn);
	if (changed !== null && now - changed >= 0 && now - changed < DAY_MS) {
		return { kind: "updated", at: record.lastChangedOn, nextTry, proxied };
	}
	return { kind: "ok", at: record.lastCheckedOn ?? null, nextTry, proxied };
};

/**
 * The error of a record or of an address in the status, ready to show: the translated key with its values when one
 * is known, else the provider's own text. The values come back camelCase from the API, so they go back to the
 * backend's placeholder names (nextWriteOn to next_write_on).
 *
 * @param   {{ error?: string | null, errorI18n?: string | null, errorValues?: Object | null } | null}  item
 * @returns {{ id: string, values: Object } | { text: string } | null}
 */
const ddnsErrorOf = (item) => {
	if (!item) return null;
	if (item.errorI18n) return { id: item.errorI18n, values: decamelizeKeys(item.errorValues ?? {}) };
	return isBlank(item.error) ? null : { text: item.error };
};

/**
 * The values of a ddns message ready to show: the time of a cooldown (next_write_on, ISO) as the formatter gives it
 *
 * @param   {Object | null | undefined}  values  the message values in the backend's names
 * @param   {(iso: string) => string}  formatTime
 * @returns {Object}
 */
const ddnsMessageValues = (values, formatTime) => {
	const done = { ...values };
	if (typeof done.next_write_on === "string") done.next_write_on = formatTime(done.next_write_on);
	return done;
};

/**
 * The ddns message of a failed request (an error.ddns-* key such as error.ddns-cooldown), its values ready to show;
 * null for any other error, which the shared API error text shows
 *
 * @param   {unknown}  err  an error thrown by src/api/backend/base.js
 * @param   {(iso: string) => string}  formatTime
 * @returns {{ id: string, values: Object } | null}
 */
const ddnsApiErrorOf = (err, formatTime) => {
	const apiError = err?.payload?.error;
	const id = apiError?.message_i18n;
	if (typeof id !== "string" || !id.startsWith("error.ddns-")) return null;
	return { id, values: ddnsMessageValues(apiError.message_values, formatTime) };
};

export {
	ddnsApiErrorOf,
	ddnsErrorOf,
	ddnsMessageValues,
	ddnsRecordPayload,
	ddnsRecordValidate,
	ddnsRulesInput,
	IP_VERSIONS,
	isIpv6Suffix,
	minTtlOf,
	normalizeRecordName,
	providerOf,
	recordStateOf,
	suggestedZone,
	zoneFor,
};
