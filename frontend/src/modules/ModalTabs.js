/**
 * The rules of the windows with tabs (ModalTabs): which tab holds a field, how many shown errors each tab holds, the
 * first error and its tab, and the keyboard moves between the tabs. A window's tabs are a list of
 * { id, labelId, fields, end? }: fields are the top-level form fields of the tab (a list such as "locations" holds
 * its rows), end puts the tab on the right (Advanced). Pure, so node --test checks them without a DOM.
 */
import { errorPaths, orderErrorPaths } from "./HookForm.js";

// a field path inside a tab field: the field itself, a nested field (fieldValues.token) or a list row (locations[0])
const inField = (path, field) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`);

// the arrow keys of Tabler's tabs (Bootstrap's Tab): right and down go to the next tab, left and up to the one before
const STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The tab that holds a field
 *
 * @param   {Object[]} tabs
 * @param   {string}   path  an error path (name, locations[0].path) or a field name
 * @returns {string|null}    the tab's id, null for a field of no tab (a message above the tabs)
 */
export function tabOfPath(tabs, path) {
	return tabs.find((tab) => tab.fields.some((field) => inField(path, field)))?.id ?? null;
}

/**
 * The number of errors each tab holds: React Hook Form's errors, which hold only the messages a field shows (it
 * was left, or a save was tried); every field of a list row counts
 *
 * @param   {Object[]} tabs
 * @param   {Object}   errors  React Hook Form's errors
 * @returns {Object}   tab id -> count, 0 for a tab without errors
 */
export function tabErrorCounts(tabs, errors) {
	const counts = Object.fromEntries(tabs.map((tab) => [tab.id, 0]));
	for (const path of errorPaths(errors)) {
		const id = tabOfPath(tabs, path);
		if (id !== null) counts[id] += 1;
	}
	return counts;
}

/**
 * The errors of some tabs together (the tabs in the "More" menu)
 *
 * @param   {Object}   counts  tabErrorCounts(...)
 * @param   {string[]} ids
 * @returns {number}
 */
export const errorCountOf = (counts, ids) => ids.reduce((sum, id) => sum + (counts[id] ?? 0), 0);

/**
 * The first error in the form's field order and the tab that holds it, for "jump to the first error"
 *
 * @param   {Object}   errors  React Hook Form's errors
 * @param   {string[]} order   the form's fields in form order
 * @param   {Object[]} [tabs]  the window's tabs, none for a form without tabs
 * @returns {{ path: string, tabId: string|null }|null}  null without errors
 */
export function firstErrorOf(errors, order, tabs = []) {
	const [path] = orderErrorPaths(errorPaths(errors), order);
	return path ? { path, tabId: tabOfPath(tabs, path) } : null;
}

/**
 * The tab a key moves to, as in Tabler's tabs: the arrow keys go to the next or the previous tab and wrap around,
 * Home and End to the first and the last
 *
 * @param   {string[]} ids      the tabs the keyboard can reach (shown in the row, not disabled), in order
 * @param   {string}   current  the focused tab
 * @param   {string}   key      KeyboardEvent.key
 * @returns {string|null}       null for any other key
 */
export function nextTabId(ids, current, key) {
	if (ids.length === 0) return null;
	if (key === "Home") return ids[0];
	if (key === "End") return ids.at(-1);
	const step = STEPS[key];
	if (step === undefined) return null;
	const index = ids.indexOf(current);
	if (index < 0) return ids[0];
	return ids[(index + step + ids.length) % ids.length];
}

/**
 * The tab that Tab reaches in the row (the others are reached with the arrow keys): the open tab, or the first one
 * the keyboard can reach while the open tab sits in the "More" menu
 *
 * @param   {string[]} ids     the tabs the keyboard can reach, in order
 * @param   {string}   active  the open tab
 * @returns {string|null}
 */
export const tabStopId = (ids, active) => (ids.includes(active) ? active : (ids[0] ?? null));
