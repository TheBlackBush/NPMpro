// A small RFC 3492 decoder, so the Domain fields judge an xn-- label the way the backend does: the backend round-trips
// the label through domainToUnicode, which browsers do not have; here the decoded label goes back through the
// browser's own URL rules (UTS 46, as Node's). Pure.

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

/** @returns {string}  the host as a browser stores it (lower case, punycode), "" when the URL rules refuse it */
export function toAscii(name) {
	try {
		return new URL(`http://${name}`).hostname;
	} catch {
		return "";
	}
}

/**
 * @param   {string} label  one lower case label
 * @returns {boolean}  whether an xn-- label is the stored form of a real IDN label: it decodes to text beyond ASCII
 *                     that the URL rules turn back into the same label (emoji and symbols included, as the backend)
 */
export function isValidAceLabel(label) {
	const decoded = decodePunycode(label.slice("xn--".length));
	return (
		decoded !== null && [...decoded].some((char) => char.codePointAt(0) > ASCII_END) && toAscii(decoded) === label
	);
}
