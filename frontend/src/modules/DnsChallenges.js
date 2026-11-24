// The challenge cleanup window (GET and POST /nginx/dns-credentials/{id}/challenges): what is ticked in advance,
// whether the delete may start, how a value and an age are shown, what the answer of a delete says. Pure.

const ID = "dns-challenges";
/** The longest a TXT value is shown before it is cut (the full value is in its tooltip) */
export const VALUE_LIMIT = 40;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

/** The keys that are still ticked after a new list: an item that is gone or in use loses its tick */
export function keepSelection(selection, items, busy) {
	if (busy) return new Set();
	const keys = new Set((items ?? []).map((item) => item.key));
	return new Set([...selection].filter((key) => keys.has(key)));
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
				id: `${ID}.result.skipped.${result.reason === "outside" ? "outside" : "changed"}`,
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
