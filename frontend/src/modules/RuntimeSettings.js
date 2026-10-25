// Keys the API accepts per group, camelCase as base.js converts them
const GROUP_KEYS = {
	certificates: [
		"keyType",
		"keySize",
		"profile",
		"mustStaple",
		"serverTlsVerify",
		"renewalInterval",
		"ocspStapling",
		"customOcspStapling",
		"defaultCertificateId",
		"echRotationInterval",
	],
	network: ["trustedIps", "trustCloudflare"],
	"forward-auth": [
		"anubisUpstream",
		"tinyauthUpstream",
		"oauth2proxyUpstream",
		"voidauthUpstream",
		"autheliaUpstream",
		"authentikUpstream",
		"anubisCustomImages",
	],
	logs: [
		"writeLogFiles",
		"logRotations",
		"goaccess",
		"goaccessKeepDays",
		"goaccessAnonymize",
		"goaccessDropQueryStrings",
		"goaccessRealOs",
		"goaccessResolveHosts",
	],
	advanced: ["configBeautifier", "gravatar", "timeZone"],
};

// applies values with a hint line; "restart" fields get the Restart required badge instead (isRestartField)
const APPLIES = new Set(["next-certificate", "reload", "immediately"]);

// the label of each restart setting (applies "restart"), for the "Restart the container to apply" notice; the same
// text as the field label
const RESTART_LABELS = {
	timeZone: "settings.advanced.time-zone",
	goaccess: "settings.logs.goaccess",
	goaccessKeepDays: "settings.logs.goaccess.keep-days",
	goaccessAnonymize: "settings.logs.goaccess.anonymize",
	goaccessDropQueryStrings: "settings.logs.goaccess.drop-query-strings",
	goaccessRealOs: "settings.logs.goaccess.real-os",
	goaccessResolveHosts: "settings.logs.goaccess.resolve-hosts",
};

const KEY_SIZES = { ecdsa: ["secp256r1", "secp384r1", "secp521r1"], rsa: ["2048", "3072", "4096"] };
const DEFAULT_KEY_SIZE = { ecdsa: "secp384r1", rsa: "4096" };

// same charset as the backend (envs.sh TRUST_IP)
const TRUST_IP_CHARS = /^[0-9a-fA-F.:/]+$/u;
const DIGITS = /^\d+$/u;
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/u;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/u;
const NEWLINE = /\r?\n/u;

// "key_name: message" (backend runtime-update.js / runtime-apply.js validation errors)
const FIELD_ERROR = /^(?<key>[a-z0-9_]+): (?<message>[\s\S]+)$/u;

const camel = (s) => s.replaceAll(/_(?<c>[a-z])/gu, (...m) => m.at(-1).c.toUpperCase());

const isIPv4 = (text) => {
	const parts = text.split(".");
	return parts.length === 4 && parts.every((part) => IPV4_PART.test(part) && Number(part) <= 255);
};

const isIPv6 = (text) => {
	if (!text.includes(":")) return false;
	const halves = text.split("::");
	if (halves.length > 2) return false;
	let count = 0;
	const groupsOf = (half) => (half === "" ? [] : half.split(":"));
	for (const [index, half] of halves.entries()) {
		const groups = groupsOf(half);
		for (const [i, group] of groups.entries()) {
			// an embedded IPv4 address ends the address and counts as two groups
			if (group.includes(".")) {
				if (index !== halves.length - 1 || i !== groups.length - 1 || !isIPv4(group)) return false;
				count += 2;
			} else if (IPV6_GROUP.test(group)) {
				count += 1;
			} else {
				return false;
			}
		}
	}
	return halves.length === 2 ? count <= 7 : count === 8;
};

/**
 * One trusted IP entry: an IPv4/IPv6 address or a CIDR range (the backend accepts the same)
 */
const isTrustedIp = (entry) => {
	if (!TRUST_IP_CHARS.test(entry)) return false;
	const parts = entry.split("/");
	if (parts.length > 2) return false;
	const v4 = isIPv4(parts[0]);
	if (!(v4 || isIPv6(parts[0]))) return false;
	if (parts.length === 1) return true;
	return DIGITS.test(parts[1]) && Number(parts[1]) <= (v4 ? 32 : 128);
};

/**
 * Trusted IPs from a textarea: one entry per line, blank lines ignored. Each error carries the 1-based line number
 * and the i18n key of its message.
 *
 * @param   {string}  text
 * @returns {{ list: string[], errors: { line: number, message: string }[] }}
 */
const parseTrustedIps = (text) => {
	const list = [];
	const errors = [];
	for (const [index, raw] of String(text ?? "")
		.split(NEWLINE)
		.entries()) {
		const entry = raw.trim();
		if (entry !== "") {
			if (isTrustedIp(entry)) {
				list.push(entry);
			} else {
				errors.push({ line: index + 1, message: "settings.network.trusted-ips.invalid" });
			}
		}
	}
	return { list, errors };
};

/**
 * Allowed key sizes for a key type; an unknown type gives the ECDSA ones (the backend default).
 */
const keySizeOptions = (keyType) => [...(KEY_SIZES[keyType] ?? KEY_SIZES.ecdsa)];

/**
 * The key size that goes with a key type when the current size is not valid for it.
 */
const defaultKeySize = (keyType) => DEFAULT_KEY_SIZE[keyType] ?? DEFAULT_KEY_SIZE.ecdsa;

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The body of a runtime settings save: only the editable keys of the group, without keys locked by the environment
 * and, when `initial` (the values as loaded) is given, without values that did not change.
 *
 * @param   {string}    group
 * @param   {Object}    values   form values (camelCase)
 * @param   {string[]}  locked   locked keys as the API returns them (snake_case)
 * @param   {Object}    [initial]
 * @returns {Object}
 */
const runtimeSettingsPayload = (group, values, locked = [], initial) => {
	const lockedKeys = new Set((locked ?? []).map(camel));
	const payload = {};
	for (const key of GROUP_KEYS[group] ?? []) {
		if (lockedKeys.has(key) || values?.[key] === undefined) continue;
		if (initial && sameValue(initial[key], values[key])) continue;
		payload[key] = values[key];
	}
	return payload;
};

/**
 * True when there is nothing to save. The API refuses an empty body, so callers skip the request.
 */
const isEmptyPayload = (payload) => !payload || Object.keys(payload).length === 0;

/**
 * The translation id of when a change of the key takes effect, from the API applies map (camelCase keys), or null
 */
const appliesMessageId = (applies, key) => {
	const value = applies?.[key];
	return APPLIES.has(value) ? `settings.runtime.applies.${value}` : null;
};

/**
 * Whether the key is a restart setting saved with another value than the container runs with (API restart_pending,
 * snake_case keys), so the container needs a restart to apply it
 *
 * @param   {string[]}  restartPending
 * @param   {string}    key  camelCase
 * @returns {boolean}
 */
const isRestartPending = (restartPending, key) => (restartPending ?? []).map(camel).includes(key);

/**
 * Whether the key applies only after a container restart (API applies map, camelCase keys)
 */
const isRestartField = (applies, key) => applies?.[key] === "restart";

/**
 * The pending restart settings as { key, labelId } in API order; labelId is null for a key without a known label
 *
 * @param   {string[]}  restartPending  API restart_pending (snake_case)
 * @returns {{ key: string, labelId: string|null }[]}
 */
const restartPendingFields = (restartPending) =>
	(restartPending ?? []).map(camel).map((key) => ({ key, labelId: RESTART_LABELS[key] ?? null }));

/**
 * The time zone options: the zones the image ships, plus the current value when it is not one of them (a TZ set by
 * env, for example a posix/ name)
 *
 * @param   {string[]}  zones
 * @param   {string}    current
 * @returns {{ value: string, label: string }[]}
 */
const timeZoneOptions = (zones, current) => {
	const names = [...(zones ?? [])];
	if (current && !names.includes(current)) names.unshift(current);
	return names.map((name) => ({ value: name, label: name }));
};

/**
 * The form field a save error belongs to: the backend prefixes validation errors with the snake_case key. Returns
 * { key (camelCase), message } for a key of the group, else null.
 *
 * @param   {string}  group
 * @param   {string}  text  the API error message
 * @returns {{ key: string, message: string } | null}
 */
const fieldOfError = (group, text) => {
	const match = FIELD_ERROR.exec(String(text ?? ""));
	if (!match) return null;
	const key = camel(match.groups.key);
	return (GROUP_KEYS[group] ?? []).includes(key) ? { key, message: match.groups.message } : null;
};

/**
 * Whether a certificate can be the default certificate, as the backend checks on save (lib/default-cert.js): not an
 * mTLS CA (no key to serve) and with certificate files. A custom certificate gets its domain names with its upload,
 * so one without domain names has no files yet; certbot certificates always have domain names.
 *
 * @param   {Object}  cert  certificate from the API (camelCase)
 * @returns {boolean}
 */
const isServableCertificate = (cert) =>
	cert?.provider !== "mtls" && Array.isArray(cert?.domainNames) && cert.domainNames.length > 0;

export {
	appliesMessageId,
	defaultKeySize,
	fieldOfError,
	GROUP_KEYS,
	isEmptyPayload,
	isRestartField,
	isRestartPending,
	isServableCertificate,
	keySizeOptions,
	parseTrustedIps,
	RESTART_LABELS,
	restartPendingFields,
	runtimeSettingsPayload,
	timeZoneOptions,
};
