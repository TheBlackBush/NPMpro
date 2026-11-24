import { assertAllowedHost } from "../outbound-guard.js";

// The custom HTTP provider's URL: https only, the placeholders {ip}, {ipv4}, {ipv6} and {name} only after the host
// (the path and the query), filled URL-encoded. The URL may hold a token, so it is sealed, scrubbed and never shown.

const PLACEHOLDER = /\{(?<key>ip|ipv4|ipv6|name)\}/gu;
const PLACEHOLDER_SPLIT = /\{(?:ip|ipv4|ipv6|name)\}/gu;
const SCHEME = /^https:\/\//iu;
const AUTHORITY = /^https:\/\/(?<authority>[^/?#]*)/iu;
const BRACES = /[{}]|%7b|%7d/iu;
const PIECE_BREAK = /[/?&=#]/u;
const MIN_PIECE = 4;
const BRACKETS = /^\[|\]$/gu;

/**
 * Checks the shape of a stored or typed URL (no network).
 *
 * @param   {String}  text
 * @returns {{ key: String }|{ sample: URL }}  key: the error key of a refusal; sample: the URL with every
 *                                              placeholder filled with a plain value, for the guard
 */
const checkUrlShape = (text) => {
	if (typeof text !== "string" || !SCHEME.test(text)) return { key: "error.ddns-custom-url-https" };
	const authority = AUTHORITY.exec(text)?.groups.authority ?? "";
	if (authority === "") return { key: "error.ddns-custom-url-invalid" };
	if (BRACES.test(authority)) return { key: "error.ddns-custom-host-placeholder" };
	if (BRACES.test(text.replace(PLACEHOLDER_SPLIT, ""))) return { key: "error.ddns-custom-url-invalid" };
	let sample;
	try {
		sample = new URL(text.replace(PLACEHOLDER, "x"));
	} catch {
		return { key: "error.ddns-custom-url-invalid" };
	}
	if (sample.protocol !== "https:" || sample.hostname === "" || sample.username !== "" || sample.password !== "") {
		return { key: "error.ddns-custom-url-invalid" };
	}
	// the fragment is never sent: a placeholder there would fill nothing
	const hash = text.indexOf("#");
	if (hash !== -1 && PLACEHOLDER_SPLIT.test(text.slice(hash))) return { key: "error.ddns-custom-host-placeholder" };
	return { sample };
};

/**
 * The shape and the outbound guard of a URL at save.
 *
 * @param   {String}  text
 * @returns {Promise<String|null>}  the key of the refusal, or null when the URL is acceptable
 */
const refusalOf = async (text) => {
	const shape = checkUrlShape(text);
	if (shape.key) return shape.key;
	try {
		await assertAllowedHost(shape.sample.href);
	} catch {
		return "error.ddns-custom-url-blocked";
	}
	return null;
};

/**
 * The URL of one call: the placeholders filled and URL-encoded.
 *
 * @param   {String}  template
 * @param   {{ ip: String, type: String, name: String, addresses?: { ipv4?: String, ipv6?: String } }}  values
 *          type is A or AAAA; addresses are the wanted addresses of the record, both when it follows both
 * @returns {String}
 */
const fillUrl = (template, { ip, type, name, addresses }) => {
	// a record of both families fills both: a placeholder is empty only when that family has no address
	const wanted = addresses ?? { ipv4: type === "AAAA" ? "" : ip, ipv6: type === "AAAA" ? ip : "" };
	const values = { ip, ipv4: wanted.ipv4 ?? "", ipv6: wanted.ipv6 ?? "", name };
	return template.replace(PLACEHOLDER, (_all, key) => encodeURIComponent(values[key]));
};

/**
 * What to scrub from every message of a call: the whole URL, its host, the part after the host and every piece of
 * it between the separators (a token sits in a path segment or a query value).
 *
 * @param   {String}  template
 * @returns {String[]}
 */
const secretsOfUrl = (template) => {
	if (typeof template !== "string" || template === "") return [];
	const authority = AUTHORITY.exec(template);
	const host = authority ? authority.groups.authority : "";
	const rest = authority ? template.slice(authority[0].length) : template;
	const literals = rest.split(PLACEHOLDER_SPLIT);
	const pieces = literals.flatMap((literal) => literal.split(PIECE_BREAK));
	// the host as the guard and the connection name it: lower case, punycode, no port, no brackets
	const shape = checkUrlShape(template);
	const named = shape.sample
		? [shape.sample.hostname, shape.sample.hostname.replace(BRACKETS, ""), shape.sample.host]
		: [];
	const all = [template, host, host.toLowerCase(), ...named, rest, ...literals, ...pieces];
	return [...new Set(all)].filter((piece) => piece.length >= MIN_PIECE);
};

export { checkUrlShape, fillUrl, refusalOf, secretsOfUrl };
