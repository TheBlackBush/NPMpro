/**
 * Rules of the forms on React Hook Form: a resolver around the existing validate functions (objects of translated
 * messages), and the field order that names and focuses the first error. Pure, so
 * node --test checks them without a DOM.
 */
import { valueAt } from "./FormFields.js";

// the parts of a field path: "items[0].username" -> items, 0, username
const PATH_PART = /[^.[\]]+/gu;
const INDEX = /^\d+$/u;
// a list index in an error path: locations[0].path
const LIST_INDEX = /\[(?<index>\d+)\]/gu;

const isObject = (value) => value !== null && typeof value === "object";
const isPlainObject = (value) => isObject(value) && Object.getPrototypeOf(value) === Object.prototype;

/**
 * A copy of object with value at path; arrays are made for numeric parts
 *
 * @param   {Object}  object
 * @param   {string}  path
 * @param   {*}       value
 * @returns {Object}
 */
export function setIn(object, path, value) {
	const parts = String(path).match(PATH_PART) ?? [];
	const root = Array.isArray(object) ? [...object] : { ...object };
	let current = root;
	parts.forEach((part, index) => {
		if (index === parts.length - 1) {
			current[part] = value;
			return;
		}
		const existing = current[part];
		if (isObject(existing)) {
			current[part] = Array.isArray(existing) ? [...existing] : { ...existing };
		} else {
			current[part] = INDEX.test(parts[index + 1]) ? [] : {};
		}
		current = current[part];
	});
	return root;
}

function mergeTwo(target, source) {
	// the errors of a list's rows: merged row by row, so a rule over the form keeps the rows' own messages
	if (Array.isArray(target) && Array.isArray(source)) {
		return Array.from({ length: Math.max(target.length, source.length) }, (_, index) =>
			source[index] === undefined ? target[index] : mergeTwo(target[index], source[index]),
		);
	}
	if (!(isPlainObject(target) && isPlainObject(source))) return source;
	const result = { ...target };
	for (const [key, value] of Object.entries(source)) {
		result[key] = Object.hasOwn(target, key) ? mergeTwo(target[key], value) : value;
	}
	return result;
}

/**
 * Error objects merged field by field (lists row by row); the later one wins a field
 *
 * @param   {...Object} lists
 * @returns {Object}
 */
export function mergeErrors(...lists) {
	return lists.reduce((merged, next) => mergeTwo(merged, next ?? {}), {});
}

/**
 * A validate function (values => errors of messages) from per-field rules and a rule over the whole form, which
 * wins a field (e.g. "Passwords must match" over the repeat's length message). rules may be a function of the
 * values, for fields that are only shown sometimes; an undefined rule is skipped. Keep the rules in form order.
 *
 * @param   {Object|Function} rules           path -> (value) => message | undefined
 * @param   {Function}        [formValidate]  (values) => errors
 * @returns {Function}  (values) => errors
 */
export function fieldsValidate(rules, formValidate) {
	return (values) => {
		const list = typeof rules === "function" ? rules(values) : rules;
		let fieldErrors = {};
		for (const [path, rule] of Object.entries(list)) {
			const message = typeof rule === "function" ? rule(valueAt(values, path)) : undefined;
			if (message) fieldErrors = setIn(fieldErrors, path, message);
		}
		return mergeErrors(fieldErrors, formValidate ? formValidate(values) : {});
	};
}

/**
 * Errors of message ids (the pure modules' validators) with their translated text
 *
 * @param   {Object}  errors  field -> translation id
 * @param   {{ formatMessage: Function }} intl
 * @returns {Object}
 */
export function translateErrors(errors, intl) {
	return Object.fromEntries(Object.entries(errors).map(([field, id]) => [field, intl.formatMessage({ id })]));
}

/**
 * Errors of text messages as React Hook Form's errors ({ type, message } at each field)
 *
 * @param   {*} errors
 * @returns {Object|Array|undefined}  undefined when there is no message
 */
export function toHookFormErrors(errors) {
	if (typeof errors === "string") return errors === "" ? undefined : { type: "validate", message: errors };
	if (Array.isArray(errors)) {
		const list = errors.map(toHookFormErrors);
		return list.some((item) => item !== undefined) ? list : undefined;
	}
	if (isObject(errors)) {
		const entries = Object.entries(errors)
			.map(([key, value]) => [key, toHookFormErrors(value)])
			.filter(([, value]) => value !== undefined);
		return entries.length > 0 ? Object.fromEntries(entries) : undefined;
	}
}

/**
 * A React Hook Form resolver around validate(values) (an object of text messages, maybe a promise)
 *
 * @param   {Function} validate
 * @returns {Function}  (values) => Promise<{ values, errors }>
 */
export function formResolver(validate) {
	return async (values) => {
		const errors = toHookFormErrors(await validate(values)) ?? {};
		return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
	};
}

const isHookFormError = (error) => isPlainObject(error) && typeof error.type === "string";

/**
 * The path of every error in an object of text messages or in React Hook Form's errors ({ type, message }):
 * name, fieldValues.token, locations[0].path
 *
 * @param   {*}       errors
 * @param   {string}  [prefix]
 * @returns {string[]}
 */
export function errorPaths(errors, prefix = "") {
	if (typeof errors === "string" || isHookFormError(errors)) return prefix ? [prefix] : [];
	if (Array.isArray(errors)) return errors.flatMap((item, index) => errorPaths(item, `${prefix}[${index}]`));
	if (isObject(errors)) {
		return Object.entries(errors)
			.filter(([key]) => key !== "root")
			.flatMap(([key, value]) => errorPaths(value, prefix ? `${prefix}.${key}` : key));
	}
	return [];
}

/**
 * The field paths of a form in the order of its defaultValues: nested plain objects give their own fields
 * (fieldValues.token), a list or any other value is one field (domainNames, types, a file)
 *
 * @param   {Object}  defaultValues
 * @param   {string}  [prefix]
 * @returns {string[]}
 */
export function fieldPaths(defaultValues, prefix = "") {
	return Object.entries(defaultValues ?? {}).flatMap(([key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return isPlainObject(value) && Object.keys(value).length > 0 ? fieldPaths(value, path) : [path];
	});
}

const orderIndex = (path, order) => {
	const index = order.findIndex(
		(field) => path === field || path.startsWith(`${field}.`) || path.startsWith(`${field}[`),
	);
	return index < 0 ? order.length : index;
};

/**
 * Error paths in the order of the form's fields (fieldPaths or an explicit list); paths of no listed field last,
 * in their own order
 *
 * @param   {string[]} paths
 * @param   {string[]} order
 * @returns {string[]}
 */
export function orderErrorPaths(paths, order) {
	return paths
		.map((path, position) => ({ path, position, index: orderIndex(path, order) }))
		.sort((a, b) => a.index - b.index || a.position - b.position)
		.map(({ path }) => path);
}

/**
 * The names a field's control may carry in the page: the error path (locations[0].path) and React Hook Form's
 * register name (locations.0.path)
 *
 * @param   {string}  path
 * @returns {string[]}
 */
export function controlNames(path) {
	return [...new Set([path, path.replaceAll(LIST_INDEX, ".$<index>")])];
}

/**
 * The paths of the rows of a list whose field holds a message (React Hook Form's errors of the list), for a check
 * of the other rows when a value they are compared with changes (a duplicate path or username)
 *
 * @param   {*}       listErrors  the errors at the list's name: one entry per row
 * @param   {string}  name        the list
 * @param   {string}  field       the field of a row
 * @returns {string[]}  e.g. ["locations.1.path"]
 */
export function rowErrorPaths(listErrors, name, field) {
	if (!Array.isArray(listErrors)) return [];
	return listErrors.flatMap((row, index) => (row?.[field] ? [`${name}.${index}.${field}`] : []));
}

/**
 * Sets every field of a change map (tlsChanges, forwardingChanges, proxyOptionChanges) in its order, dirty as a
 * user's change; under a row's path when prefix is given ("locations.2" -> locations.2.forwardScheme). Convention:
 * a caller whose own field was just set (register, a controller) drops that field from changes, or passes it only
 * when the map sets another value.
 *
 * @param   {Function} setValue  React Hook Form's setValue
 * @param   {Object}   changes   name -> value
 * @param   {string}   [prefix]  the path of a list row
 */
export function applyChanges(setValue, changes, prefix = "") {
	for (const [key, value] of Object.entries(changes)) {
		setValue(prefix ? `${prefix}.${key}` : key, value, { shouldDirty: true });
	}
}

/**
 * The resetOptions of useAppForm: what a reset (new loaded values, a reset call) keeps. keepEdits: the fields the user
 * already changed. Otherwise every field takes the new values, but the form stays submitted: React Hook Form's reset
 * clears isSubmitted and submitCount, and after a save (refetched values) messages must still follow each change.
 *
 * @param   {boolean} keepEdits
 * @returns {Object}
 */
export function resetOptionsOf(keepEdits) {
	return keepEdits ? { keepDirtyValues: true } : { keepIsSubmitted: true, keepSubmitCount: true };
}
