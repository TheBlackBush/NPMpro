// The challenge cleanup window (GET and POST /nginx/dns-credentials/{id}/challenges): what is ticked in advance,
// whether the delete may start, how a value and an age are shown, what the answer of a delete says. Pure.

const ID = "dns-challenges";
/** The longest a TXT value is shown before it is cut (the full value is in its tooltip) */
export const VALUE_LIMIT = 40;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// the text of each skip reason, written out whole (the unused-key check reads them here)
const SKIPPED_IDS = {
	changed: "dns-challenges.result.skipped.changed",
	outside: "dns-challenges.result.skipped.outside",
	busy: "dns-challenges.result.skipped.busy",
};

/**
 * The items ticked when the window opens: only those the backend preselected (a known age over one hour), and only
 * when no certificate request runs. A record of unknown age is never ticked in advance.
 *
 * @param   {Array<{ key: string, ageSeconds: number|null, preselected: boolean }>} items  the list, in camelCase
 * @param   {boolean} busy  a certbot run of this instance is going on
 * @returns {Set<string>}  the keys
 */
export function initialSelection(items, busy) {
	if (busy) return new Set();
	return new Set(
		(items ?? [])
			.filter((item) => item.preselected === true && Number.isInteger(item.ageSeconds))
			.map((item) => item.key),
	);
}

/** Whether the delete may start: something is ticked and no certificate request runs */
export const canDelete = (selection, busy) => !busy && (selection?.size ?? 0) > 0;

/**
 * A TXT value as the list shows it: at most VALUE_LIMIT characters, the cut marked with an ellipsis
 *
 * @param   {string} text
 * @returns {string}
 */
export function shortValue(text) {
	const value = String(text ?? "");
	return value.length <= VALUE_LIMIT ? value : `${value.slice(0, VALUE_LIMIT - 1)}…`;
}

/**
 * The age of an item as a message
 *
 * @param   {number|null|undefined} ageSeconds
 * @returns {{ id: string, values: Object }}
 */
export function ageText(ageSeconds) {
	if (!Number.isInteger(ageSeconds) || ageSeconds < 0) return { id: `${ID}.age.unknown`, values: {} };
	if (ageSeconds < MINUTE) return { id: `${ID}.age.now`, values: {} };
	if (ageSeconds < HOUR) return { id: `${ID}.age.minutes`, values: { count: Math.floor(ageSeconds / MINUTE) } };
	if (ageSeconds < DAY) return { id: `${ID}.age.hours`, values: { count: Math.floor(ageSeconds / HOUR) } };
	return { id: `${ID}.age.days`, values: { count: Math.floor(ageSeconds / DAY) } };
}

/**
 * The body of the delete request: the ticked items as the list showed them (the backend lists again and skips an item
 * that changed). The list's order is kept.
 *
 * @param   {Array<{ key: string, name: string, id: string|null, values: string[] }>} items
 * @param   {Set<string>} selection
 */
export const deleteBody = (items, selection) =>
	(items ?? [])
		.filter((item) => selection.has(item.key))
		.map((item) => ({ name: item.name, id: item.id, values: item.values }));

/** Whether a ticked item has no known age: the confirmation then says that another program may use it */
export const hasUnknownAge = (items, selection) =>
	(items ?? []).some((item) => (selection ? selection.has(item.key) : true) && !Number.isInteger(item.ageSeconds));

const sameItem = (a, b) =>
	a !== undefined &&
	b !== undefined &&
	(a.id ?? null) === (b.id ?? null) &&
	a.name === b.name &&
	JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? []);

/**
 * The keys that are still ticked after a new list. A tick stays only on an item that is still there with the same id,
 * name and values as the user saw it: an item that is gone, in use or changed (a whole TXT set with another value, for
 * a provider whose key leaves the values out) loses its tick and shows unticked.
 *
 * @param   {Set<string>} selection
 * @param   {Array} previous  the list the user ticked on
 * @param   {Array} items     the new list
 * @param   {boolean} busy
 * @returns {Set<string>}
 */
export function keepSelection(selection, previous, items, busy) {
	if (busy) return new Set();
	const before = new Map((previous ?? []).map((item) => [item.key, item]));
	const now = new Map((items ?? []).map((item) => [item.key, item]));
	return new Set([...selection].filter((key) => sameItem(before.get(key), now.get(key))));
}

/**
 * What one result of a delete shows
 *
 * @param   {{ result: string, reason?: string, message?: string }} result
 * @returns {{ tone: "success"|"muted"|"warning"|"destructive", id: string, detail: string|null }}
 */
export function resultLine(result) {
	switch (result?.result) {
		case "deleted":
			return { tone: "success", id: `${ID}.result.deleted`, detail: null };
		case "gone":
			return { tone: "muted", id: `${ID}.result.gone`, detail: null };
		case "skipped":
			return {
				tone: "warning",
				id: SKIPPED_IDS[result.reason] ?? SKIPPED_IDS.changed,
				detail: null,
			};
		default:
			return {
				tone: "destructive",
				id: `${ID}.result.failed`,
				detail: typeof result?.message === "string" && result.message !== "" ? result.message : null,
			};
	}
}

/** The counts of a delete's results, and whether the toast is a success (nothing skipped or failed) */
export function resultCounts(results) {
	const counts = { deleted: 0, gone: 0, skipped: 0, failed: 0 };
	for (const entry of results ?? []) {
		const key = Object.hasOwn(counts, entry?.result) ? entry.result : "failed";
		counts[key] += 1;
	}
	return { ...counts, ok: counts.skipped === 0 && counts.failed === 0 };
}

/** The most records one delete request takes (the route's limit) */
export const BATCH_LIMIT = 100;

/** The body items cut into requests of at most BATCH_LIMIT, in order */
export function batchesOf(body) {
	const list = body ?? [];
	const batches = [];
	for (let start = 0; start < list.length; start += BATCH_LIMIT) batches.push(list.slice(start, start + BATCH_LIMIT));
	return batches;
}

/**
 * Sends the batches one after another and merges the results. A batch that fails (busy, no locks, any error) stops
 * the rest: nothing further is sent.
 *
 * @param   {(batch: Array) => Promise<{ results: Array }>} send
 * @param   {Array} body  the items to delete
 * @returns {Promise<{ results: Array, done: number, total: number, error: unknown }>}  done: the records of the
 *          batches that were answered; error: the failure that stopped the run, or null
 */
export function runBatches(send, body) {
	const batches = batchesOf(body);
	const total = (body ?? []).length;
	const results = [];
	// one batch after the other: the next is sent when the previous answered
	const step = async (index, done) => {
		if (index >= batches.length) return { results, done, total, error: null };
		try {
			const answer = await send(batches[index]);
			results.push(...(answer?.results ?? []));
			return step(index + 1, done + batches[index].length);
		} catch (error) {
			return { results, done, total, error };
		}
	};
	return step(0, 0);
}

/** The keys "Select all" ticks: every record that is not in use (unknown age and recent ones too: an explicit action) */
export const selectAllKeys = (items, busy) => (busy ? new Set() : new Set((items ?? []).map((item) => item.key)));

/** The state of the "Select all" box: true, false or "indeterminate" */
export function selectAllState(items, selection, busy) {
	const total = (items ?? []).length;
	const ticked = (items ?? []).filter((item) => selection?.has(item.key)).length;
	if (busy || total === 0 || ticked === 0) return false;
	return ticked === total ? true : "indeterminate";
}
