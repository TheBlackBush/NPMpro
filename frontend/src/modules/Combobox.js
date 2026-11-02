/**
 * Rules of the shared Combobox (components/Combobox.jsx): how typed and pasted text becomes entries, which options a
 * query shows and when a typed value is offered as a new one. Pure, so node --test checks them without a DOM.
 */

// commas, spaces and line breaks separate entries
const SEPARATORS = /[\s,]+/u;

const defaultNormalize = (entry) => String(entry).trim().toLowerCase();

/**
 * The entries of a typed or pasted text: split on commas, spaces and new lines, trimmed, without empty ones
 *
 * @param   {string} text
 * @returns {string[]}
 */
export function splitEntries(text) {
	return String(text ?? "")
		.split(SEPARATORS)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * The list with the entries of a text appended, in order, skipping the ones it already holds (compared after
 * normalize, lower case and trimmed by default)
 *
 * @param   {string[]} current
 * @param   {string}   text
 * @param   {Object}   [options]
 * @param   {Function} [options.normalize]  (entry) => the form two entries are compared in
 * @returns {string[]}
 */
export function addEntries(current, text, { normalize = defaultNormalize } = {}) {
	const list = [...(current ?? [])];
	const seen = new Set(list.map(normalize));
	for (const entry of splitEntries(text)) {
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
 * @param   {Function} [isValid]  (entry) => boolean, every entry by default
 * @returns {{ accepted: string[], rejected: string[] }}
 */
export function partitionEntries(text, isValid = () => true) {
	const accepted = [];
	const rejected = [];
	for (const entry of splitEntries(text)) {
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
