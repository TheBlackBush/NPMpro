// Values for the shadcn Select (Radix), which reserves the empty string for "no value": an option whose value is ""
// (a location without a modifier) travels as EMPTY_ITEM inside the Select and as "" everywhere else. Pure, so
// node --test checks it without a DOM.

export const EMPTY_ITEM = "__empty__";

/** The Select's item value for a form value (numbers become strings, "" becomes EMPTY_ITEM) */
export function toItemValue(value) {
	const text = value === null || value === undefined ? "" : String(value);
	return text === "" ? EMPTY_ITEM : text;
}

/** The form value for a Select item value: "" back from EMPTY_ITEM, a number when the field stores numbers */
export function fromItemValue(item, { valueAsNumber = false } = {}) {
	const text = item === EMPTY_ITEM ? "" : item;
	return valueAsNumber ? Number(text) : text;
}

/**
 * The options of a list of <option> elements (the children a SelectField caller writes): { value, label, disabled }
 * with the value as a string; anything that is not an option element is skipped
 *
 * @param {Array} elements  React.Children.toArray(children)
 */
export function optionsFromElements(elements) {
	return elements
		.filter((element) => element && typeof element === "object" && element.type === "option")
		.map((element) => ({
			value: String(element.props.value ?? ""),
			label: element.props.children,
			disabled: Boolean(element.props.disabled),
		}));
}
