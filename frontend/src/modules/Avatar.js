/**
 * A user's avatar when there is no real picture: the initials on a brand colour. Pure, so node --test runs it.
 * The backend stores the default picture path when Gravatar is off or fails; that counts as "no picture".
 */

export const defaultAvatar = "/images/default-avatar.jpg";

// Brand colours (the stops of --brand-gradient plus darker shades), each with the text colour that gives at least
// 4.5:1 (WCAG AA). The class names are written out in full so Tailwind compiles them (the CSP forbids style injection).
export const avatarColors = [
	{ bg: "#ff8a00", text: "#111111", className: "bg-[#ff8a00] text-[#111111]" },
	{ bg: "#ff2d55", text: "#111111", className: "bg-[#ff2d55] text-[#111111]" },
	{ bg: "#d91aff", text: "#111111", className: "bg-[#d91aff] text-[#111111]" },
	{ bg: "#7a3bff", text: "#ffffff", className: "bg-[#7a3bff] text-[#ffffff]" },
	{ bg: "#00d1ff", text: "#111111", className: "bg-[#00d1ff] text-[#111111]" },
	{ bg: "#c2410c", text: "#ffffff", className: "bg-[#c2410c] text-[#ffffff]" },
	{ bg: "#a812cc", text: "#ffffff", className: "bg-[#a812cc] text-[#ffffff]" },
	{ bg: "#0e7490", text: "#ffffff", className: "bg-[#0e7490] text-[#ffffff]" },
];

const segmenter =
	typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function firstGrapheme(word) {
	if (segmenter) {
		const [first] = segmenter.segment(word);
		return first ? first.segment : "";
	}
	return String.fromCodePoint(word.codePointAt(0));
}

/**
 * True when the URL is not a real picture: empty, missing or the stored default picture
 *
 * @param   {string|null|undefined} url
 * @returns {boolean}
 */
export function hasNoPicture(url) {
	return typeof url !== "string" || url === "" || url === defaultAvatar;
}

/**
 * The initials: first letter of the first and the last word of the name (one word: its first letter), upper case.
 * Without a name the first letter of the email; without both an empty string.
 *
 * @param   {string|null|undefined} name
 * @param   {string|null|undefined} [email]
 * @returns {string}
 */
export function initials(name, email) {
	const words = typeof name === "string" ? name.trim().split(/\s+/u).filter(Boolean) : [];
	if (words.length > 0) {
		const picked = words.length === 1 ? [words[0]] : [words[0], words.at(-1)];
		return picked.map((word) => firstGrapheme(word).toUpperCase()).join("");
	}
	const mail = typeof email === "string" ? email.trim() : "";
	return mail ? firstGrapheme(mail).toUpperCase() : "";
}

/**
 * A stable index into the palette for a name (FNV-1a hash): the same name always gives the same colour
 *
 * @param   {string|null|undefined} name
 * @param   {string|null|undefined} [email]  used when there is no name
 * @returns {number}
 */
export function colorIndex(name, email) {
	const key = (typeof name === "string" && name.trim()) || (typeof email === "string" ? email.trim() : "");
	let hash = 0x81_1c_9d_c5;
	for (const char of key) {
		hash = Math.imul(hash ^ char.codePointAt(0), 0x01_00_01_93) >>> 0;
	}
	return hash % avatarColors.length;
}

/**
 * The palette entry (background and text classes) for a user
 *
 * @param   {string|null|undefined} name
 * @param   {string|null|undefined} [email]
 * @returns {{ bg: string, text: string, className: string }}
 */
export function avatarColor(name, email) {
	return avatarColors[colorIndex(name, email)];
}
