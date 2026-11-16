// the number of brand tones a tag can have (--tag-0 .. --tag-9 in styles/globals.css)
export const TAG_TONES = 10;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * The tone (0 to 9) of a tag: FNV-1a over its lower-case trimmed name, so the same tag has the same colour on every
 * host, in the window and in the filter, whatever its case
 * @param {string} [name]
 * @returns {number}
 */
export function tagTone(name) {
	let hash = FNV_OFFSET;
	for (const char of String(name ?? "")
		.trim()
		.toLowerCase()) {
		// biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is an xor and a 32-bit multiply
		hash ^= char.codePointAt(0);
		// biome-ignore lint/suspicious/noBitwiseOperators: back to an unsigned 32-bit number
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash % TAG_TONES;
}

/**
 * The classes that colour a badge for a tag (styles/globals.css)
 * @param {string} [name]
 * @returns {string}
 */
export function tagToneClass(name) {
	return `tag-tone tag-tone-${tagTone(name)}`;
}
