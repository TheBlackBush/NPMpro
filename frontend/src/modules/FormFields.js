/**
 * Rules of the shared form layer (components/Form/FormField.jsx and friends): reading a value at a field path, how a
 * control is described, the classes of the groups. Pure, so node --test checks them without a DOM.
 */
import cn from "clsx";

// the parts of a field path: "items[0].username" -> items, 0, username
const PATH_PART = /[^.[\]]+/gu;

/**
 * The value at a field path ("name", "fieldValues.token", "items[0].username") in the form's values
 *
 * @param   {*}       object
 * @param   {string}  path
 * @returns {*}
 */
export function valueAt(object, path) {
	let current = object;
	for (const part of String(path).match(PATH_PART) ?? []) {
		if (current === null || current === undefined) return;
		current = current[part];
	}
	return current;
}

/**
 * The value of a number input kept as a number, as the Formik forms kept it: the number typed, or "" while the input
 * holds no number (empty). For register's setValueAs, where a field's logic compares it with numbers (a port that
 * follows the database engine).
 *
 * @param   {string}  text  the input's value
 * @returns {number|""}
 */
export function numberInputValue(text) {
	const number = Number.parseFloat(text);
	return Number.isNaN(number) ? "" : number;
}

/**
 * Space separated ids for aria-describedby, without empty or repeated ones
 *
 * @param   {...(string|null|undefined)} ids
 * @returns {string|undefined}
 */
export function joinIds(...ids) {
	const list = [...new Set(ids.flatMap((id) => String(id ?? "").split(" ")).filter(Boolean))];
	return list.length > 0 ? list.join(" ") : undefined;
}

/**
 * The ids of a field and the aria attributes of its control: described by the error (first) and the hint together,
 * so the error never replaces the hint, plus any ids the caller adds
 *
 * @param   {Object}  options
 * @param   {string}  options.id
 * @param   {boolean} [options.hasHint]
 * @param   {string|null} [options.error]  the message that shows
 * @param   {string}  [options.describedBy]
 */
export function controlAria({ id, hasHint = false, error = null, describedBy }) {
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	return {
		labelId: `${id}-label`,
		hintId,
		errorId,
		"aria-invalid": error ? "true" : undefined,
		"aria-describedby": joinIds(error ? errorId : null, hasHint ? hintId : null, describedBy),
	};
}

/**
 * The classes of a section's legend: the group heading style (text-base) for a heading, the label style otherwise;
 * hidden, it stays for screen readers
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.heading]
 * @param   {boolean} [options.hideLegend]
 * @returns {string}
 */
export function legendClass({ heading = false, hideLegend = false } = {}) {
	if (hideLegend) return "sr-only";
	return cn("mb-1.5 font-medium", heading ? "text-base" : "text-sm");
}

/**
 * The classes of a section's fieldset: a column of fields; boxed is a tinted, bordered panel
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.boxed]
 * @returns {string}
 */
export function sectionClass({ boxed = false } = {}) {
	return cn("flex min-w-0 flex-col gap-3", boxed && "rounded-lg border bg-muted/30 p-4");
}

/**
 * The classes of a ChoiceGroup's list of options: a wrapping row, or one option per line when vertical
 *
 * @param   {Object}  [options]
 * @param   {"buttons"|"pills"|"boxes"} [options.variant]
 * @param   {boolean} [options.fill]
 * @param   {boolean} [options.vertical]
 * @returns {string}
 */
export function choiceGroupClass({ vertical = false } = {}) {
	return vertical ? "flex flex-col gap-2" : "flex flex-row flex-wrap gap-2";
}

/**
 * The classes of one option of a ChoiceGroup (a card around a radio): pills are round, an option of a filled row
 * takes its share (a described box the whole line); a disabled option looks disabled
 *
 * @param   {Object}  [options]
 * @param   {"buttons"|"pills"|"boxes"} [options.variant]
 * @param   {boolean} [options.fill]
 * @returns {string}
 */
export function choiceItemClass({ variant = "buttons", fill = false } = {}) {
	return cn(
		variant === "pills" ? "rounded-full" : "rounded-lg",
		// FieldLabel makes a card full width; an option that is not filling the row sits inline
		fill ? (variant === "boxes" ? "w-full" : "min-w-0 flex-1") : "has-[>[data-slot=field]]:w-fit",
		// also disabled by a fieldset (View windows), not only by the option's own prop
		"has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
	);
}

/**
 * The classes of a SwitchList: settings rows in one column, or two columns from the md breakpoint
 *
 * @param   {1|2} [columns]
 * @returns {string}
 */
export function switchListClass(columns = 1) {
	return columns === 2 ? "grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2" : "flex flex-col gap-3";
}
