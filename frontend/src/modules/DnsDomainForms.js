// The rules of the DNS domain fields (Add domains, the DNS credential window's Domains line). normalizeDnsDomain is
// the twin of backend/lib/dns-domain-name.js: both tests run backend/test/fixtures/dns-domain-cases.json. Pure.

const MAX_NAME = 253;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;
const TRAILING_DOT = /\.$/u;
const NOT_IN_A_NAME = /[\s/\\?#@:%[\]]/u;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const INVALID = Object.freeze({ error: "error.dns-domain-invalid" });

/** @returns {string}  the host as a browser stores it (lower case, punycode), "" when the URL rules refuse it */
export function toAscii(name) {
	try {
		return new URL(`http://${name}`).hostname;
	} catch {
		return "";
	}
}

/**
 * @param   {unknown} input
 * @returns {{ name: string } | { error: string }}  error: the i18n key (error.dns-domain-*)
 */
export function normalizeDnsDomain(input) {
	if (typeof input !== "string") return INVALID;
	const trimmed = input.trim().replace(TRAILING_DOT, "");
	if (trimmed.includes("*")) return { error: "error.dns-domain-wildcard" };
	if (trimmed === "" || NOT_IN_A_NAME.test(trimmed) || IPV4.test(trimmed)) return INVALID;
	const ascii = toAscii(trimmed);
	if (ascii === "" || IPV4.test(ascii)) return INVALID;
	const labels = ascii.split(".");
	if (labels.length === 1 && LABEL.test(ascii)) return { error: "error.dns-domain-one-label" };
	if (ascii.length > MAX_NAME || labels.length < 2 || !labels.every((label) => LABEL.test(label))) return INVALID;
	return { name: ascii };
}

/**
 * The entered names the owner already keeps on another credential (the backend refuses the save for them)
 *
 * @param   {string[]}    names
 * @param   {Object}      context
 * @param   {number|null} context.credentialId  the credential being edited, null for a new one
 * @param   {number}      context.ownerUserId   the owner of that credential
 * @param   {Object[]}    [context.domains]     useDnsDomains(["credential"]) rows
 * @returns {Map<string, string>}  entered name -> the name of the credential that holds it
 */
export function takenNames(names, { credentialId, ownerUserId, domains }) {
	const held = new Map();
	for (const domain of domains ?? []) {
		if (domain.dnsCredentialId !== credentialId && domain.credential?.ownerUserId === ownerUserId) {
			held.set(domain.name, domain.credential.name);
		}
	}
	const taken = new Map();
	for (const name of names ?? []) {
		const stored = normalizeDnsDomain(name).name;
		if (stored && held.has(stored)) taken.set(name, held.get(stored));
	}
	return taken;
}
