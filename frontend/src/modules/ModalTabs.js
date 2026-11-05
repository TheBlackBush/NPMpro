/**
 * The rules of the windows with tabs (ModalTabs): which tab holds a field, how many shown errors each tab holds, the
 * first error and its tab (the keyboard moves between the tabs are Radix's). A window's tabs are a list of
 * { id, labelId, fields }: fields are the top-level form fields of the tab (a list such as "locations" holds
 * its rows). Pure, so node --test checks them without a DOM.
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
