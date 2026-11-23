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
const MIN_TTL = 60;
const MAX_TTL = 86_400;
const WILDCARD_PREFIX = "*.";
const TRAILING_DOT = /\.$/u;
const WILDCARD_LEAD = /^\*\./u;
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

	if (!isBlank(values.ttl)) {
		const text = String(values.ttl).trim();
		const ttl = WHOLE_NUMBER.test(text) ? Number(text) : Number.NaN;
		if (!(ttl >= MIN_TTL && ttl <= MAX_TTL)) errors.ttl = problem("ddns.error.ttl-range");
	}
	return errors;
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

export {
	ddnsErrorOf,
	ddnsRecordValidate,
	isIpv6Suffix,
	normalizeRecordName,
	providerOf,
	recordStateOf,
	suggestedZone,
	zoneFor,
};
