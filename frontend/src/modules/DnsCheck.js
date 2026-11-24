// What the DNS credential Test shows: the badge tone and text of an answer of POST /nginx/dns-credentials/{id}/test
// and whether the Test button may run. Pure.

const ID = "dns-credentials.test";
const TONES = {
	works: "success",
	"wrong-key": "destructive",
	"missing-right": "destructive",
	refused: "destructive",
	failed: "warning",
	unreachable: "warning",
	blocked: "warning",
};
// the text of each state, written out whole (the unused-key check reads them here)
const MESSAGES = {
	works: "dns-credentials.test.works",
	"wrong-key": "dns-credentials.test.wrong-key",
	"missing-right": "dns-credentials.test.missing-right",
	refused: "dns-credentials.test.refused",
	failed: "dns-credentials.test.failed",
	unreachable: "dns-credentials.test.unreachable",
	blocked: "dns-credentials.test.blocked",
};

/**
 * @param   {{ supported: boolean, state: string|null, needs: string|null, message: string|null }|undefined} answer
 *          the answer in camelCase
 * @returns {{ state: string, tone: "success"|"destructive"|"warning"|"muted", messageId: string,
 *            values: Object, detail: string|null }|null}  null before an answer
 *          detail: the provider's own (scrubbed) message, never for works
 */
export function testStateOf(answer) {
	if (!answer) return null;
	if (!answer.supported) {
		return { state: "unsupported", tone: "muted", messageId: `${ID}.unsupported`, values: {}, detail: null };
	}
	// a state this version does not know reads as the general failure
	const known = Object.hasOwn(TONES, answer.state);
	const state = known ? answer.state : "failed";
	// a missing right names the right; without one the general refusal is shown
	const named = state === "missing-right" && typeof answer.needs === "string" && answer.needs !== "";
	const shown = state === "missing-right" && !named ? "refused" : state;
	return {
		state,
		tone: TONES[state],
		messageId: MESSAGES[shown],
		values: named ? { hint: answer.needs } : {},
		detail:
			state !== "works" && typeof answer.message === "string" && answer.message !== "" ? answer.message : null,
	};
}

/**
 * Whether the Test button may run, and why not
 *
 * @param   {{ supported: boolean, dirty: boolean }} options  supported: the provider has a read call to test with;
 *          dirty: the form holds a change that is not saved (the test reads the saved values)
 * @returns {{ disabled: boolean, reasonId: string|null }}
 */
export function testAvailability({ supported, dirty }) {
	if (!supported) return { disabled: true, reasonId: `${ID}.unsupported` };
	if (dirty) return { disabled: true, reasonId: `${ID}.save-first` };
	return { disabled: false, reasonId: null };
}

// The host check (POST and GET /nginx/dns-check/hosts): what a name's result shows, which result a host list shows
// beside its names, which hosts a list checks, and the toast's counts. Pure.

const CHECK_ID = "dns-check";
// the host check's states by tone; skipped is no result of its own (nothing was looked at)
const CHECK_TONES = {
	here: "success",
	partly: "warning",
	elsewhere: "destructive",
	none: "destructive",
	unknown: "warning",
	skipped: "muted",
};
// the worst state of a host first: what a list badge shows for the host
const WORST_FIRST = ["none", "elsewhere", "partly", "unknown", "here"];
const REASONS = [
	"skipped-pattern",
	"lookup-timeout",
	"lookup-servfail",
	"lookup-error",
	"public-address-unknown",
	"public-ipv6-unknown",
	"provider-read-failed",
	"provider-read-skipped",
	"timeout",
	"check-failed",
];
const VIA_IDS = { record: "record", wildcard: "wildcard", alias: "alias" };
/** The most hosts one request checks */
export const CHECK_LIMIT = 50;
/** The most names one request checks, across its hosts */
export const NAME_LIMIT = 200;

const stateOfName = (result) => (Object.hasOwn(CHECK_TONES, result?.state) ? result.state : "unknown");

/**
 * The state a host list shows beside the names of a host: the worst of its names (none and elsewhere red, partly and
 * unknown amber, here green); skipped names are ignored
 *
 * @param   {Array<{ state: string }>|undefined} results  the names of one host's check
 * @returns {{ state: string, tone: string }|null}  null when no name was looked at
 */
export function hostCheckBadge(results) {
	const states = (results ?? []).map(stateOfName).filter((state) => state !== "skipped");
	const worst = WORST_FIRST.find((state) => states.includes(state));
	return worst === undefined ? null : { state: worst, tone: CHECK_TONES[worst] };
}

/** The wildcard name that answered for a name: `*.` and the name without its first label */
export const wildcardOf = (name) => `*.${String(name).split(".").slice(1).join(".")}`;

/**
 * What one name's line shows
 *
 * @param   {Object} result  one entry of a host check's names (camelCase)
 * @returns {{ state: string, tone: string, stateId: string, addresses: string[], via: { id: string, values: Object }|null,
 *            proxied: boolean, reason: { id: string, detail: string|null }|null }}
 *          via: only for a name that reaches this instance by a record, a wildcard or an alias (a plain DNS answer
 *          has none); reason: why a name was not or only partly checked, detail the provider's scrubbed message
 */
export function nameLine(result) {
	const state = stateOfName(result);
	const reaches = state === "here" || state === "partly";
	const viaKey = reaches ? VIA_IDS[result.via] : undefined;
	const code = typeof result?.reason === "string" ? result.reason : null;
	const known = code !== null && REASONS.includes(code);
	return {
		state,
		tone: CHECK_TONES[state],
		stateId: `${CHECK_ID}.state.${state}`,
		addresses: [...(result?.ipv4?.found ?? []), ...(result?.ipv6?.found ?? [])],
		via:
			viaKey === undefined
				? null
				: {
						id: `${CHECK_ID}.via.${viaKey}`,
						values: viaKey === "wildcard" ? { name: wildcardOf(result.name) } : {},
					},
		proxied: reaches && result.proxied === true,
		reason:
			code === null
				? null
				: {
						id: `${CHECK_ID}.reason.${known ? code : "check-failed"}`,
						detail:
							code === "provider-read-failed" &&
							typeof result.message === "string" &&
							result.message !== ""
								? result.message
								: null,
					},
	};
}

const lower = (name) => String(name).toLowerCase();

/**
 * The lines of the DNS card: one per name of the form, in the form's order, with the host's result for it (null for a
 * name that was not checked)
 *
 * @param   {string[]|undefined} formNames
 * @param   {Array<{ name: string }>|undefined} results  the names of the host's check
 * @returns {Array<{ name: string, result: Object|null }>}
 */
export function cardLines(formNames, results) {
	const byName = new Map((results ?? []).map((result) => [lower(result.name), result]));
	const seen = new Set();
	const lines = [];
	for (const name of Array.isArray(formNames) ? formNames : []) {
		if (!seen.has(lower(name))) {
			seen.add(lower(name));
			lines.push({ name, result: byName.get(lower(name)) ?? null });
		}
	}
	return lines;
}

/** Whether the names in the form differ from the names the check looked at (the host was changed after it) */
export function namesChanged(formNames, results) {
	const form = new Set((Array.isArray(formNames) ? formNames : []).map(lower));
	const checked = new Set((results ?? []).map((result) => lower(result.name)));
	return form.size !== checked.size || [...form].some((name) => !checked.has(name));
}

const keyOf = (type, id) => `${type}:${id}`;

/** The checks of one host type by host id */
export function checksOfType(checks, type) {
	return new Map((checks ?? []).filter((entry) => entry.type === type).map((entry) => [entry.id, entry]));
}

/** The check of one host, or undefined */
export const checkOfHost = (checks, type, id) => (checks ?? []).find((entry) => entry.type === type && entry.id === id);

/** The cached checks with the fresh ones: a fresh entry replaces the cached one of the same host */
export function mergeChecks(cached, fresh) {
	const merged = new Map((cached ?? []).map((entry) => [keyOf(entry.type, entry.id), entry]));
	for (const entry of fresh ?? []) merged.set(keyOf(entry.type, entry.id), entry);
	return [...merged.values()];
}

const nameCountOf = (row) => new Set((row?.domainNames ?? []).map(lower)).size;

/**
 * The hosts a list checks: every row of the page it shows, in requests of at most CHECK_LIMIT hosts and NAME_LIMIT
 * names, in order
 *
 * @param   {string} type  proxy, redirection or dead
 * @param   {Array<{ id: number, domainNames?: string[] }>} rows  the rows of the current page
 * @returns {Array<Array<{ type: string, id: number }>>}  the requests; none for an empty page
 */
export function checkBatches(type, rows) {
	const batches = [];
	let batch = [];
	let names = 0;
	for (const row of rows ?? []) {
		const count = nameCountOf(row);
		if (batch.length > 0 && (batch.length >= CHECK_LIMIT || names + count > NAME_LIMIT)) {
			batches.push(batch);
			batch = [];
			names = 0;
		}
		batch.push({ type, id: row.id });
		names += count;
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/**
 * The counts the toast of a check shows, per name
 *
 * @param   {Array<{ names: Array<{ state: string }> }>} hosts  the answer of the check
 * @returns {{ checked: number, here: number, away: number, none: number, unknown: number }}
 *          away: the names that answer other addresses or reach this instance with one family only; none: the names
 *          with no address; skipped names are not counted
 */
export function checkCounts(hosts) {
	const counts = { checked: 0, here: 0, away: 0, none: 0, unknown: 0 };
	for (const host of hosts ?? []) {
		for (const result of host.names ?? []) {
			const state = stateOfName(result);
			if (state !== "skipped") {
				counts.checked += 1;
				if (state === "here") counts.here += 1;
				else if (state === "unknown") counts.unknown += 1;
				else if (state === "none") counts.none += 1;
				else counts.away += 1;
			}
		}
	}
	return counts;
}
