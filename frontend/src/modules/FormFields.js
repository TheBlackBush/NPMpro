/**
 * Rules of the shared form layer (components/Form/FormField.jsx and friends): when an error shows, how a control is
 * described, the classes of the groups. Pure, so node --test checks them without a DOM.
 */
import cn from "clsx";

// the parts of a Formik path: "items[0].username" -> items, 0, username
const PATH_PART = /[^.[\]]+/gu;

/**
 * The value at a Formik path ("name", "fieldValues.token", "items[0].username") in Formik's errors or touched
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
 * The error a field shows: its message once the field was left (touched) or a save was tried (submitCount > 0).
 * Only a text message counts: the errors of a list field belong to its rows.
 *
 * @param   {Object}  state
 * @param   {*}       state.error
 * @param   {*}       [state.touched]
 * @param   {number}  [state.submitCount]
 * @returns {string|null}
 */
export function visibleError({ error, touched = false, submitCount = 0 }) {
	if (typeof error !== "string" || error === "") return null;
	return touched || submitCount > 0 ? error : null;
}

/**
 * visibleError of the field at path, read from Formik's errors and touched (Formik's form object fits as it is)
 *
 * @param   {{ errors: Object, touched: Object, submitCount: number }} form
 * @param   {string}  path
 * @returns {string|null}
 */
export function visibleErrorAt({ errors, touched, submitCount }, path) {
	return visibleError({ error: valueAt(errors, path), touched: Boolean(valueAt(touched, path)), submitCount });
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
 * @param   {string|null} [options.error]  the message that shows (visibleError)
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
