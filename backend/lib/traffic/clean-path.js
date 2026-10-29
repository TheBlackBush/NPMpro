const MAX_PATH = 200;

// a run of percent escapes: decoded together, so a multi-byte UTF-8 character stays one character
const ESCAPES = /(?:%[0-9A-Fa-f]{2})+/gu;
// "http://host" of an absolute-form request target
const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/u;
const SLASHES = /\/{2,}/gu;
const BROKEN_ESCAPE = /%[0-9A-Fa-f]?$/u;
// characters that stay percent-encoded after decoding: controls (C0, C1), format characters (bidi overrides, zero
// width, BOM), every space and separator, and ? # ; (a stored path must never look like it has a query string)
const UNSAFE = /[\p{Cc}\p{Cf}\p{Z}?#;]/u;
const EMAIL = /^[^@/]+@[^@/]+\.[^@/]+$/u;
const DIGITS = /^\d{4,}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX = /^[0-9a-f]{16,}$/iu;
// JWTs, dotted, base64 (+ =) and base64url tokens
const TOKEN = /^[\w.~+=-]{16,}$/u;
// a token candidate inside a segment, next to characters a token does not use
const TOKEN_RUN = /[\w.~+=-]{16,}/gu;
const HAS_DIGIT = /\d/u;
const HAS_LETTER = /[A-Za-z]/u;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/u;
// 6 or more digits inside a segment; 4 and 5 digit runs (years, ports) stay
const DIGIT_RUN = /\d{6,}/gu;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** encodeURIComponent of the unsafe characters only (as UTF-8 bytes, upper case hex). */
const encodeUnsafe = (text) => {
	let out = "";
	for (const ch of text) out += UNSAFE.test(ch) ? encodeURIComponent(ch) : ch;
	return out;
};

/** Length of the UTF-8 sequence a lead byte starts; 1 for ASCII and for a byte that cannot start one. */
const sequenceLength = (lead) => {
	if (lead >= 0xf0) return 4;
	if (lead >= 0xe0) return 3;
	if (lead >= 0xc0) return 2;
	return 1;
};

/** Decodes a run of escapes; a byte that is not part of a valid UTF-8 character keeps its escape as it was written. */
const decodeRun = (run) => {
	const bytes = Buffer.from(run.replaceAll("%", ""), "hex");
	let out = "";
	let i = 0;
	while (i < bytes.length) {
		const lead = bytes[i];
		const size = sequenceLength(lead);
		let decoded = null;
		if (lead < 0x80) {
			decoded = String.fromCharCode(lead);
		} else if (size > 1 && i + size <= bytes.length) {
			try {
				decoded = STRICT_UTF8.decode(bytes.subarray(i, i + size));
			} catch {
				decoded = null;
			}
		}
		if (decoded === null) {
			out += run.slice(i * 3, i * 3 + 3);
			i += 1;
		} else {
			out += encodeUnsafe(decoded);
			i += lead < 0x80 ? 1 : size;
		}
	}
	return out;
};

const isToken = (text) =>
	DIGITS.test(text) ||
	UUID.test(text) ||
	HEX.test(text) ||
	(TOKEN.test(text) && HAS_DIGIT.test(text) && HAS_LETTER.test(text));

/** A token with a file extension becomes ":id.<ext>", a token ":id"; anything else is kept. */
const maskToken = (text) => {
	const ext = EXTENSION.exec(text);
	if (ext && ext.index > 0 && isToken(text.slice(0, ext.index))) return `:id${ext[0]}`;
	return isToken(text) ? ":id" : text;
};

/**
 * One path segment: an email becomes ":email"; a whole token ":id" (":id.<ext>" with a file extension); else every
 * token inside it (a run of 16 or more token characters next to other characters, for example "!" or "%20") and
 * every run of 6 or more digits ":id".
 */
const cleanSegment = (segment) => {
	if (EMAIL.test(segment)) return ":email";
	const whole = maskToken(segment);
	if (whole !== segment) return whole;
	return segment.replace(TOKEN_RUN, maskToken).replace(DIGIT_RUN, ":id");
};

/** Drops a high surrogate or an incomplete escape the 200 character cut left at the end (only when it cut). */
const trimCut = (text) => {
	if (text.length <= MAX_PATH) return text;
	let out = text.slice(0, MAX_PATH);
	const last = out.charCodeAt(out.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
	return out.replace(BROKEN_ESCAPE, "");
};

/**
 * The stored form of a missing page path: only the path of an absolute-form target, percent escapes decoded once
 * (an invalid escape keeps its text; controls, format characters, spaces and separators, ?, # and ; stay encoded),
 * repeated slashes collapsed, emails replaced with ":email" and IDs and tokens with ":id" (see cleanSegment), cut at
 * 200 characters without a broken character or escape at the end. Never empty.
 *
 * @param   {string}  raw  the path of the parsed request line (query string and fragment already cut)
 * @returns {string}
 */
const cleanPath = (raw) => {
	const target = String(raw ?? "").replace(ABSOLUTE, "");
	const decoded = target.replaceAll(ESCAPES, decodeRun).replaceAll(SLASHES, "/");
	const cleaned = decoded.split("/").map(cleanSegment).join("/");
	const path = trimCut(cleaned);
	return path === "" ? "/" : path;
};

export { cleanPath, MAX_PATH };
