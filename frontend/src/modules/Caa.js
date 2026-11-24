// The CAA check (POST /nginx/certificates/caa-check and GET /nginx/certificates/caa): the request a window sends, the
// worst result of its names, what one name's line says and which list entries show a badge. Pure.

const ID = "certificates.caa";
/** How long the names and the CA stay unchanged before a window asks (it asks while the user types) */
export const CAA_DEBOUNCE_MS = 800;
/** The most names one request checks */
export const CAA_MAX_NAMES = 100;
/** The most name lines a note or a tooltip shows; the rest is counted */
export const CAA_MAX_LINES = 5;

// a name worth asking about: a host or wildcard name (no regular expression, port or nginx syntax character)
const ASKABLE = /^(?:\*\.)?[^\s/;{}"'\\#~:*]+$/u;
const MAX_NAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LEADING_WILDCARD = /^\*\./u;
const TRAILING_DOT = /\.$/u;

// every label is 1 to 63 characters and neither starts nor ends with a hyphen (a trailing root dot is allowed)
const labelsFit = (name) =>
	name
		.replace(LEADING_WILDCARD, "")
		.replace(TRAILING_DOT, "")
		.split(".")
		.every(
			(label) =>
				label.length >= 1 && label.length <= MAX_LABEL_LENGTH && !label.startsWith("-") && !label.endsWith("-"),
		);

// the states that warn, worst first, with the tone of the note and the badge
const WARNING_TONES = { refused: "destructive", limited: "warning", unknown: "warning" };
// the line text of each warning state, written out whole (the unused-key check reads them here)
const LINE_MESSAGES = {
	refused: "certificates.caa.refused",
	limited: "certificates.caa.limited",
	unknown: "certificates.caa.unknown",
};
const WARNING_ORDER = Object.keys(WARNING_TONES);
const REASONS = [
	"none",
	"no-issue-property",
	"listed",
	"listed-parameters-unchecked",
	"not-listed",
	"forbidden",
	"validationmethods",
	"accounturi",
	"critical-unknown-tag",
	"lookup-timeout",
	"lookup-servfail",
	"lookup-error",
	"lookup-too-deep",
	"skipped-pattern",
	"no-identity",
];

/**
 * The request a window sends for its form, or null while there is nothing to ask (no usable name, or no CA yet)
 *
 * @param   {Object}   options
 * @param   {string[]} [options.names]   the form's domain names
 * @param   {string}   [options.server]  the chosen CA's directory URL; empty: the instance CA answers
 * @param   {boolean}  [options.dnsChallenge]
 * @param   {boolean}  [options.needsServer]  true: no request until a CA is chosen (a re-issue)
 * @returns {{ domainNames: string[], acmeServer?: string, dnsChallenge: boolean }|null}
 */
export function caaRequest({ names, server, dnsChallenge, needsServer = false }) {
	if (needsServer && !server) return null;
	const seen = new Set();
	const domainNames = [];
	for (const raw of Array.isArray(names) ? names : []) {
		const name = String(raw ?? "").trim();
		if (
			name !== "" &&
			name.length <= MAX_NAME_LENGTH &&
			ASKABLE.test(name) &&
			labelsFit(name) &&
			!seen.has(name.toLowerCase())
		) {
			seen.add(name.toLowerCase());
			domainNames.push(name);
		}
	}
	if (domainNames.length === 0) return null;
	return {
		domainNames: domainNames.slice(0, CAA_MAX_NAMES),
		...(server ? { acmeServer: server } : {}),
		dnsChallenge: dnsChallenge === true,
	};
}

const isNoIdentity = (result) => result?.state === "not-checked" && result.reason === "no-identity";

/**
 * The worst result of the names: refused, then limited, then unknown; a CA that names no CAA identity says so when
 * nothing worse is found. Allowed names and names that were not looked at (a pattern) show nothing.
 *
 * @param   {Array<{ state: string, reason: string|null }>|undefined} results  the names of a check
 * @returns {{ state: string, tone: string, results: Array }|null}  the results that have the worst state; null: nothing to show
 */
export function worstCaa(results) {
	const list = Array.isArray(results) ? results : [];
	for (const state of WARNING_ORDER) {
		const found = list.filter((result) => result?.state === state);
		if (found.length > 0) return { state, tone: WARNING_TONES[state], results: found };
	}
	const unnamed = list.filter(isNoIdentity);
	return unnamed.length > 0 ? { state: "no-identity", tone: "info", results: unnamed.slice(0, 1) } : null;
}

/**
 * What one name's line says. The text of messageId takes `at`, `record`, `name` and `ca` (the caller adds the CA's name).
 *
 * @param   {Object} result  one entry of a check's names (camelCase)
 * @returns {{ state: string, tone: string, messageId: string, values: Object, reasonId: string|null }}
 */
export function caaLine(result) {
	const state = Object.hasOwn(WARNING_TONES, result?.state) ? result.state : "unknown";
	const code = typeof result?.reason === "string" ? result.reason : null;
	const values = { name: result?.name ?? "", at: result?.foundAt ?? "", record: result?.record ?? "" };
	if (isNoIdentity(result)) {
		return {
			state: "no-identity",
			tone: "info",
			messageId: typeof result.errorI18n === "string" ? result.errorI18n : `${ID}.reason.no-identity`,
			values,
			reasonId: null,
		};
	}
	// a lookup code this version does not know reads as the general lookup failure
	const known = code !== null && REASONS.includes(code);
	const fallback = state === "unknown" ? "lookup-error" : null;
	const reason = known ? code : fallback;
	return {
		state,
		tone: WARNING_TONES[state],
		messageId: LINE_MESSAGES[state],
		values,
		reasonId: reason === null ? null : `${ID}.reason.${reason}`,
	};
}

/**
 * The lines a note or a tooltip shows for results: at most CAA_MAX_LINES, the rest counted
 *
 * @param   {Array} results
 * @returns {{ lines: Array<{ name: string, line: Object }>, more: number }}
 */
export function caaLines(results) {
	const list = Array.isArray(results) ? results : [];
	return {
		lines: list.slice(0, CAA_MAX_LINES).map((result) => ({ name: result.name, line: caaLine(result) })),
		more: Math.max(0, list.length - CAA_MAX_LINES),
	};
}

/**
 * What the certificate list shows for one certificate's cached entry: a badge for refused, limited and unknown (the
 * names with that state go into the tooltip), nothing for the rest
 *
 * @param   {{ state: string, names: Array }|undefined} entry  one entry of the GET (camelCase)
 * @returns {{ state: string, tone: string, results: Array }|null}
 */
export function caaBadge(entry) {
	if (!entry || !Object.hasOwn(WARNING_TONES, entry.state)) return null;
	const worst = worstCaa(entry.names);
	if (worst !== null && worst.state === entry.state) return worst;
	// an entry whose names do not show its state: the badge still warns, the tooltip has no line
	return { state: entry.state, tone: WARNING_TONES[entry.state], results: [] };
}

/** The cached entries by certificate id */
export const caaById = (entries) =>
	new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.certificateId, entry]));
