/**
 * The rules of the windows with tabs (ModalTabs): which tab holds a field, how many shown errors each tab holds, the
 * first error and its tab, and which tabs move into the "More" menu. A window's tabs are a list of
 * { id, labelId, fields, end? }: fields are the top-level form fields of the tab (a list such as "locations" holds
 * its rows), end puts the tab on the right (Advanced). Pure, so node --test checks them without a DOM.
 */
import { errorPaths, orderErrorPaths } from "./HookForm.js";

// a field path inside a tab field: the field itself, a nested field (fieldValues.token) or a list row (locations[0])
const inField = (path, field) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`);

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
 * The tabs that move into the "More" menu: the row keeps its tabs from the start while they fit next to More (and
 * the gaps between them); when every tab fits, More does not show and nothing moves
 *
 * @param   {Array<{ id: string, width: number }>} tabs  the row's tabs in order, as wide as they render
 * @param   {number} available  the row's width; 0 while it is not laid out (nothing moves then)
 * @param   {number} moreWidth  the width of the More button
 * @param   {number} gap        the gap between two buttons of the row
 * @returns {string[]}  the ids of the tabs in More, in order
 */
export function tabsInMenu(tabs, available, moreWidth, gap) {
	const total = tabs.reduce((sum, tab, index) => sum + tab.width + (index > 0 ? gap : 0), 0);
	if (available <= 0 || total <= available) return [];
	let used = 0;
	let kept = 0;
	for (const tab of tabs) {
		const next = used + (kept > 0 ? gap : 0) + tab.width;
		if (next + gap + moreWidth > available) break;
		used = next;
		kept += 1;
	}
	return tabs.slice(kept).map((tab) => tab.id);
}
