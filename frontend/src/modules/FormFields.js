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
 * The class of a field label; Tabler's required class draws the red asterisk
 *
 * @param   {boolean} [required]
 * @returns {string}
 */
export function labelClass(required = false) {
	return cn("form-label", required && "required");
}

/**
 * The classes of a ChoiceGroup's list (a RadioGroup): its options in a row that wraps, or one per line (vertical, the
 * described boxes); fill: the options share the whole row. The variant only decides whether an option shows its
 * description (boxes), so the list looks the same for every variant
 *
 * @param   {Object}  [options]
 * @param   {"buttons"|"pills"|"boxes"} [options.variant]
 * @param   {boolean} [options.fill]
 * @param   {boolean} [options.vertical]
 * @returns {string}
 */
export function choiceGroupClass({ fill = false, vertical = false } = {}) {
	return vertical ? "tw:flex tw:flex-col tw:gap-2" : cn("tw:flex tw:flex-wrap tw:gap-2", fill && "tw:w-full");
}

/**
 * The classes of one option of a ChoiceGroup (a choice card): it takes its share of a filled row; a disabled option
 * shows the not-allowed cursor (the card dims itself)
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.fill]
 * @param   {boolean} [options.disabled]
 * @returns {string}
 */
export function choiceItemClass({ fill = false, disabled = false } = {}) {
	return cn("tw:min-w-0", fill && "tw:flex-1", disabled && "tw:cursor-not-allowed");
}

/**
 * The classes of a SwitchList: rows in one column, or two columns from the md breakpoint
 *
 * @param   {1|2} [columns]
 * @returns {string}
 */
export function switchListClass(columns = 1) {
	return columns === 2
		? "tw:grid tw:grid-cols-1 tw:gap-x-6 tw:gap-y-3 tw:md:grid-cols-2"
		: "tw:flex tw:flex-col tw:gap-3";
}

/**
 * A native checkbox drawn as shadcn's Switch (src/ui has none on purpose): its look comes from the input's own state
 * (:checked, :disabled, also inside a View window's disabled fieldset, aria-invalid), so register(), the change
 * event's target.checked and the focus of the first error work as with any checkbox. The thumb is its ::before.
 */
export const SWITCH_CLASS = [
	"tw:peer tw:relative tw:inline-flex tw:h-[18.4px] tw:w-8 tw:shrink-0 tw:cursor-pointer tw:appearance-none",
	"tw:items-center tw:rounded-full tw:border tw:border-transparent tw:bg-input tw:transition-all tw:outline-none",
	"tw:dark:bg-input/80 tw:checked:bg-primary tw:dark:checked:bg-primary",
	"tw:focus-visible:border-ring tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50",
	"tw:disabled:cursor-not-allowed tw:disabled:opacity-50",
	"tw:aria-invalid:border-destructive tw:aria-invalid:ring-3 tw:aria-invalid:ring-destructive/20",
	"tw:before:pointer-events-none tw:before:block tw:before:size-4 tw:before:rounded-full tw:before:bg-background",
	"tw:before:transition-transform tw:before:content-[''] tw:checked:before:translate-x-[calc(100%-2px)]",
	"tw:dark:before:bg-foreground tw:dark:checked:before:bg-primary-foreground",
].join(" ");
