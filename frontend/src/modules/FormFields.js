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
