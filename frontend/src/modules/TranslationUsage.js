/**
 * Which translation keys (translations/ui/en.json) the code uses, for translations/check-unused.js (UX-35). A key
 * counts as used when the code holds it as a whole string ("settings.nginx", 'x', `x`), or when a template literal
 * can build it: `settings.default-site.${value}` covers every key that starts with settings.default-site. and
 * `${key}.confirm` every key that ends in .confirm. Templates whose fixed text is not a key's (a path, a CSS size)
 * cover nothing. Pure, so node --test checks it.
 */

// a quoted string on one line: "...", '...' (no escapes needed for keys)
const QUOTED = /"(?<double>[^"\\\n]*)"|'(?<single>[^'\\\n]*)'/gu;
// a template literal, and its ${...} parts
const TEMPLATE = /`(?<body>[^`]*)`/gu;
const SUBSTITUTION = /\$\{[^}]*\}/gu;
// the fixed text of a template that may build a key: key characters only, at least one dot, three letters or more
const KEY_TEXT = /^[a-z0-9._-]*$/u;
const SEPARATORS = /[._-]/gu;
const SPECIAL = /[.*+?^${}()|[\]\\]/gu;

const escapeRegex = (text) => text.replaceAll(SPECIAL, "\\$&");

// whether a template's fixed text can be part of a key
const keyLike = (fixed) => KEY_TEXT.test(fixed) && fixed.includes(".") && fixed.replaceAll(SEPARATORS, "").length >= 3;

/**
 * What one source file says about keys: its whole strings and the patterns of its templates
 *
 * @param   {string} source
 * @returns {{ strings: string[], patterns: RegExp[] }}
 */
export function keyUsesOf(source) {
	const strings = [];
	const patterns = [];
	for (const match of source.matchAll(QUOTED)) strings.push(match.groups.double ?? match.groups.single);
	for (const match of source.matchAll(TEMPLATE)) {
		const { body } = match.groups;
		const parts = body.split(SUBSTITUTION);
		if (parts.length === 1) strings.push(body);
		else if (keyLike(parts.join(""))) patterns.push(new RegExp(`^${parts.map(escapeRegex).join(".+")}$`, "u"));
	}
	return { strings, patterns };
}

/**
 * The keys no source uses, in the order given
 *
 * @param   {string[]} keys     the keys of en.json
 * @param   {string[]} sources  the text of every source file
 * @returns {string[]}
 */
export function unusedKeys(keys, sources) {
	const strings = new Set();
	const patterns = [];
	for (const source of sources) {
		const uses = keyUsesOf(source);
		for (const text of uses.strings) strings.add(text);
		patterns.push(...uses.patterns);
	}
	return keys.filter((key) => !(strings.has(key) || patterns.some((pattern) => pattern.test(key))));
}
