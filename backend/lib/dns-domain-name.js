import { isIP } from "node:net";
import { domainToASCII, domainToUnicode } from "node:url";

// The name of a DNS domain (a zone) a DNS credential manages: stored lower case and in ASCII (an IDN as punycode),
// without the trailing dot, with two labels or more of letters, digits and hyphens; no wildcard, no address.
// frontend/src/modules/DnsDomainForms.js normalizeDnsDomain is its twin: both tests run
// test/fixtures/dns-domain-cases.json.

const MAX_NAME = 253;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;
const TRAILING_DOT = /\.$/u;
// characters a URL host stops at or refuses: checked before the conversion, which would drop what follows them
const NOT_IN_A_NAME = /[\s/\\?#@:%[\]]/u;
const INVALID = Object.freeze({ error: "error.dns-domain-invalid" });

/**
 * @param   {unknown} input
 * @returns {{ name: string } | { error: string }}  error: the i18n key of the refusal
 */
const normalizeDomainName = (input) => {
	if (typeof input !== "string") return INVALID;
	const trimmed = input.trim().replace(TRAILING_DOT, "");
	if (trimmed.includes("*")) return { error: "error.dns-domain-wildcard" };
	if (trimmed === "" || NOT_IN_A_NAME.test(trimmed) || isIP(trimmed) !== 0) return INVALID;
	// lower case, punycode; "" for a name the URL rules refuse; a numeric name such as 1.2.3 becomes an address
	const ascii = domainToASCII(trimmed);
	if (ascii === "" || isIP(ascii) !== 0) return INVALID;
	const labels = ascii.split(".");
	if (labels.length === 1 && LABEL.test(ascii)) return { error: "error.dns-domain-one-label" };
	if (ascii.length > MAX_NAME || labels.length < 2 || !labels.every((label) => LABEL.test(label))) return INVALID;
	// an xn-- label that does not decode to a real IDN label (xn--a.com) stays as it is when converted back
	if (labels.some((label) => label.startsWith("xn--") && domainToUnicode(label) === label)) return INVALID;
	return { name: ascii };
};

/**
 * The where clause of a search in the stored names: the text anywhere in the name, without case; % and _ are plain
 * characters. "!" escapes them: a backslash is itself an escape in MySQL's string literals, so escape '\' does not
 * parse there.
 *
 * @param   {string} text
 * @returns {{ sql: string, bindings: string[] }}  for whereRaw
 */
const nameSearch = (text) => ({
	sql: "lower(npmpro_dns_domain.name) like ? escape '!'",
	bindings: [`%${text.toLowerCase().replace(/[!%_]/gu, "!$&")}%`],
});

export { nameSearch, normalizeDomainName };
