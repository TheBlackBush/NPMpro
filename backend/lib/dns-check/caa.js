// The CAA rules of RFC 8659 (and the two RFC 8657 parameters) for one name: given the Relevant RRset in the shape of
// Node's resolveCaa ({ critical, <tag>: <value> } per record, an extra `type` key ignored), does it let a CA with the
// given identities issue for the name? Pure: the climb that finds the set is in caa-lookup.js.
//
// States: allowed (reason: none, no-issue-property, listed, listed-parameters-unchecked), refused (reason:
// critical-unknown-tag, forbidden, not-listed, validationmethods), limited (reason: accounturi).

const CRITICAL = 128;
const KNOWN_TAGS = new Set(["issue", "issuewild", "iodef"]);
const IGNORED_KEYS = new Set(["critical", "type"]);
const MAX_RECORD_TEXT = 500;
const TRAILING_DOT = /\.$/u;

const tagOf = (record) => Object.keys(record).find((key) => !IGNORED_KEYS.has(key));

const isCritical = (record) => Number(record.critical) >= CRITICAL;

const normalized = (records) =>
	(Array.isArray(records) ? records : [])
		.filter((record) => record !== null && typeof record === "object" && tagOf(record) !== undefined)
		.map((record) => {
			const tag = tagOf(record);
			return { tag: tag.toLowerCase(), value: String(record[tag]), critical: isCritical(record) };
		});

const textOf = (records) =>
	records
		.map((record) => `${record.critical ? "128" : "0"} ${record.tag} "${record.value}"`)
		.join("\n")
		.slice(0, MAX_RECORD_TEXT);

const identityKey = (text) => text.trim().toLowerCase().replace(TRAILING_DOT, "");

// issue-value (RFC 8659 section 4.2): issuer domain, then ";"-separated tag=value parameters
const parseValue = (value) => {
	const [issuer, ...rest] = value.split(";");
	const parameters = new Map();
	for (const part of rest) {
		const text = part.trim();
		const at = text.indexOf("=");
		if (at > 0) parameters.set(text.slice(0, at).trim().toLowerCase(), text.slice(at + 1).trim());
	}
	return { issuer: identityKey(issuer), parameters };
};

/**
 * @param   {Object}    options
 * @param   {String}    options.name        the name to issue for; `*.x` is a wildcard
 * @param   {Array}     options.records     the Relevant RRset (resolveCaa shape); empty or missing: no set
 * @param   {String[]}  options.identities  the CA's CAA identities (any one counts)
 * @param   {String}    options.method      the challenge: dns-01 or http-01
 * @param   {boolean}   [options.parameters]  false: validationmethods and accounturi are shown and not compared
 *                                          (only Let's Encrypt is known to honour them)
 * @returns {{ state: String, reason: String, record: String|null }}
 */
const evaluateCaa = ({ name, records, identities, method, parameters = true }) => {
	const set = normalized(records);
	if (set.length === 0) return { state: "allowed", reason: "none", record: null };

	const critical = set.filter((item) => item.critical && !KNOWN_TAGS.has(item.tag));
	if (critical.length > 0) return { state: "refused", reason: "critical-unknown-tag", record: textOf(critical) };

	const wild = String(name).startsWith("*.");
	const wildcards = set.filter((item) => item.tag === "issuewild");
	const tag = wild && wildcards.length > 0 ? "issuewild" : "issue";
	const relevant = set.filter((item) => item.tag === tag);
	if (relevant.length === 0) return { state: "allowed", reason: "no-issue-property", record: null };

	const wanted = new Set(identities.map(identityKey));
	const record = textOf(relevant);
	let limited = null;
	let methodRefused = false;
	let unchecked = null;
	for (const property of relevant) {
		const { issuer, parameters: found } = parseValue(property.value);
		if (issuer === "" || !wanted.has(issuer)) continue;
		if (!parameters) {
			if (found.size === 0) return { state: "allowed", reason: "listed", record: textOf([property]) };
			unchecked ??= property;
			continue;
		}
		const methods = found.get("validationmethods");
		if (methods !== undefined && !methods.split(",").some((label) => label.trim().toLowerCase() === method)) {
			methodRefused = true;
			continue;
		}
		if (found.has("accounturi")) {
			limited ??= property;
			continue;
		}
		return { state: "allowed", reason: "listed", record: textOf([property]) };
	}
	if (unchecked) return { state: "allowed", reason: "listed-parameters-unchecked", record: textOf([unchecked]) };
	if (limited) return { state: "limited", reason: "accounturi", record: textOf([limited]) };
	if (methodRefused) return { state: "refused", reason: "validationmethods", record };
	const forbidden = relevant.every((property) => parseValue(property.value).issuer === "");
	return { state: "refused", reason: forbidden ? "forbidden" : "not-listed", record };
};

export { evaluateCaa };
