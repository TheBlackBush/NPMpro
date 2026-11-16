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
 * The list with the entries of a text appended (see appendEntries)
 *
 * @param   {string[]} current
 * @param   {string}   text
 * @param   {Object}   [options]
 * @param   {Function} [options.normalize]   (entry) => the form two entries are compared in
 * @param   {Object}   [options.separators]  WORD_ENTRIES (default) or LINE_ENTRIES
 * @returns {string[]}
 */
export function addEntries(current, text, { normalize, separators } = {}) {
	return appendEntries(current, splitEntries(text, separators), { normalize });
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
