// A small RFC 3492 decoder, so the Domain fields judge an xn-- label the way the backend does (it round-trips the
// label through domainToUnicode, which browsers do not have). Pure.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;
const MAX_PAYLOAD = 59;
const ASCII_END = 0x7f;
const LETTERS_NUMBERS_MARKS = /^[\p{L}\p{M}\p{N}]$/u;

const digitOf = (code) => {
	if (code >= 0x30 && code <= 0x39) return code - 0x16;
	if (code >= 0x61 && code <= 0x7a) return code - 0x61;
	return BASE;
};

const adapt = (delta, points, first) => {
	let d = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
	d += Math.floor(d / points);
	let k = 0;
	while (d > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
		d = Math.floor(d / (BASE - T_MIN));
		k += BASE;
	}
	return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
};

/**
 * Decodes the payload of an xn-- label.
 *
 * @param   {string} payload  the label without its xn-- prefix, lower case
 * @returns {string|null}  the decoded text, null when it does not decode
 */
export function decodePunycode(payload) {
	if (typeof payload !== "string" || payload === "" || payload.length > MAX_PAYLOAD) return null;
	const delimiter = payload.lastIndexOf("-");
	const output = [...payload.slice(0, Math.max(delimiter, 0))].map((char) => char.codePointAt(0));
	if (output.some((code) => code > ASCII_END)) return null;
	let n = INITIAL_N;
	let i = 0;
	let bias = INITIAL_BIAS;
	let index = delimiter > 0 ? delimiter + 1 : 0;
	while (index < payload.length) {
		const oldI = i;
		let w = 1;
		for (let k = BASE; ; k += BASE) {
			if (index >= payload.length) return null;
			const digit = digitOf(payload.charCodeAt(index++));
			if (digit >= BASE) return null;
			i += digit * w;
			let t = k - bias;
			if (t < T_MIN) t = T_MIN;
			else if (t > T_MAX) t = T_MAX;
			if (digit < t) break;
			w *= BASE - t;
			if (!Number.isSafeInteger(w) || !Number.isSafeInteger(i)) return null;
		}
		bias = adapt(i - oldI, output.length + 1, oldI === 0);
		n += Math.floor(i / (output.length + 1));
		i %= output.length + 1;
		if (n > MAX_CODE_POINT) return null;
		output.splice(i++, 0, n);
	}
	return String.fromCodePoint(...output);
}

/**
 * @param   {string} label  one lower case label
 * @returns {boolean}  whether an xn-- label decodes to a real IDN label (letters, marks and numbers beyond ASCII)
 */
export function isValidAceLabel(label) {
	const decoded = decodePunycode(label.slice("xn--".length));
	if (decoded === null) return false;
	const chars = [...decoded];
	return (
		chars.some((char) => char.codePointAt(0) > ASCII_END) &&
		chars.every((char) => char.codePointAt(0) <= ASCII_END || LETTERS_NUMBERS_MARKS.test(char))
	);
}
