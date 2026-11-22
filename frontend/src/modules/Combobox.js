/**
 * Rules of the shared Combobox (components/Combobox.jsx): how typed and pasted text becomes entries, which options a
 * query shows and when a typed value is offered as a new one. Pure, so node --test checks them without a DOM.
 */

// how typed and pasted text becomes entries: words (domain names: spaces, commas and line breaks separate) or lines
// (tags, which may hold spaces: only commas and line breaks separate); join puts refused entries back as text
export const WORD_ENTRIES = Object.freeze({ split: /[\s,]+/u, join: " ", paste: /[\s,]/u });
export const LINE_ENTRIES = Object.freeze({ split: /[,\r\n]+/u, join: ", ", paste: /[,\r\n]/u });

const defaultNormalize = (entry) => String(entry).trim().toLowerCase();

/**
 * The entries of a typed or pasted text: split by the separators (words by default), trimmed, without empty ones
 *
 * @param   {string} text
 * @param   {Object} [separators]  WORD_ENTRIES or LINE_ENTRIES
 * @returns {string[]}
 */
export function splitEntries(text, separators = WORD_ENTRIES) {
	return String(text ?? "")
		.split(separators.split)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * The list with the entries appended, in order, skipping the ones it already holds (compared after normalize,
 * lower case and trimmed by default)
 *
 * @param   {string[]} current
 * @param   {string[]} entries
 * @param   {Object}   [options]
 * @param   {Function} [options.normalize]  (entry) => the form two entries are compared in
 * @returns {string[]}
 */
export function appendEntries(current, entries, { normalize = defaultNormalize } = {}) {
	const list = [...(current ?? [])];
	const seen = new Set(list.map(normalize));
	for (const entry of entries) {
		const key = normalize(entry);
		if (!seen.has(key)) {
			seen.add(key);
			list.push(entry);
		}
	}
	return list;
}

/**
 * The list without its last entry
 *
 * @param   {Array} current
 * @returns {Array}
 */
export function removeLast(current) {
	return (current ?? []).slice(0, -1);
}

/**
 * The options whose label holds the query, case-insensitive; every option for an empty query
 *
 * @param   {Object[]} options
 * @param   {string}   query
 * @param   {Function} getLabel  (option) => its label
 * @returns {Object[]}
 */
export function filterOptions(options, query, getLabel) {
	const needle = String(query ?? "")
		.trim()
		.toLowerCase();
	if (needle === "") return options ?? [];
	return (options ?? []).filter((option) =>
		String(getLabel(option) ?? "")
			.toLowerCase()
			.includes(needle),
	);
}

/**
 * Whether a typed query is offered as a new value: not empty once trimmed, and not (case-insensitive) the label of
 * an option or a value the field already holds
 *
 * @param   {string}   query
 * @param   {Object[]} options
 * @param   {Array}    current   the values the field holds
 * @param   {Function} getLabel  (option) => its label
 * @returns {boolean}
 */
export function canCreate(query, options, current, getLabel) {
	const needle = String(query ?? "")
		.trim()
		.toLowerCase();
	if (needle === "") return false;
	const same = (text) => String(text ?? "").toLowerCase() === needle;
	return !(options ?? []).some((option) => same(getLabel(option))) && !(current ?? []).some(same);
}

/**
 * The entries of a typed or pasted text parted into the ones a field accepts (isValid) and the ones it keeps as text
 * for the user to correct
 *
 * @param   {string}   text
 * @param   {Function} [isValid]     (entry) => boolean, every entry by default
 * @param   {Object}   [separators]  WORD_ENTRIES (default) or LINE_ENTRIES
 * @returns {{ accepted: string[], rejected: string[] }}
 */
export function partitionEntries(text, isValid = () => true, separators = WORD_ENTRIES) {
	const accepted = [];
	const rejected = [];
	for (const entry of splitEntries(text, separators)) {
		(isValid(entry) ? accepted : rejected).push(entry);
	}
	return { accepted, rejected };
}

/**
 * Whether a single value means "nothing chosen": null, undefined or an empty string (0 is a value)
 *
 * @param   {*} value
 * @returns {boolean}
 */
export function isEmptyValue(value) {
	return value === null || value === undefined || value === "";
}

/**
 * The options grouped for the list: consecutive options with the same groupLabel share one group, the options without
 * one stay together under a null label
 *
 * @param   {Object[]} items
 * @returns {Array<{ label: string|null, items: Object[] }>}
 */
export function groupsOf(items) {
	const groups = [];
	for (const item of items ?? []) {
		const label = item.groupLabel ?? null;
		const last = groups.at(-1);
		if (last && last.label === label) last.items.push(item);
		else groups.push({ label, items: [item] });
	}
	return groups;
}

/**
 * The keys of the list in order: the options, then the "Add ..." entry; with createFirst the entry leads (and is the
 * one the field highlights, so Enter adds exactly the typed text)
 *
 * @param   {Object}   input
 * @param   {string[]} input.itemKeys
 * @param   {string}   [input.createKey]  absent when "Add ..." is not offered
 * @param   {boolean}  [input.createFirst]
 * @returns {string[]}
 */
export function orderKeys({ itemKeys, createKey, createFirst = false }) {
	if (!createKey) return itemKeys;
	return createFirst ? [createKey, ...itemKeys] : [...itemKeys, createKey];
}

/**
 * The options with the one that is exactly the typed text (by label or value, case-insensitive) moved first, for a
 * createFirst list that offers no "Add ..." because that option already is the text: Enter then picks it, not another
 * option that merely contains it
 *
 * @param   {Object[]} items
 * @param   {string}   query
 * @param   {Function} getLabel  (option) => its label
 * @param   {Function} getValue  (option) => its value
 * @returns {Object[]}
 */
export function exactFirst(items, query, getLabel, getValue) {
	const needle = String(query ?? "")
		.trim()
		.toLowerCase();
	const index =
		needle === ""
			? -1
			: items.findIndex(
					(o) =>
						!o.disabled &&
						[getLabel(o), getValue(o)].some((text) => String(text ?? "").toLowerCase() === needle),
				);
	if (index <= 0) return items;
	return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}
