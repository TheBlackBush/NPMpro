import { useCallback, useId, useRef } from "react";
import { isEmptyValue } from "src/modules/Combobox";
import { joinIds } from "src/modules/FormFields";
import { MultipleCombobox } from "./ComboboxMultiple";
import { defaultLabel, defaultNormalize, defaultValue } from "./ComboboxParts";
import { SingleCombobox } from "./ComboboxSingle";

/**
 * A searchable choice on Popover and Command (WAI-ARIA combobox): one value (a button that opens the list) or, with
 * multiple, a list of values as chips with a text input. creatable lets the user add values the options do not list.
 * The list is portalled as a Radix layer above a window, so Escape closes only the list. Spread FormField's control
 * on it, or pass invalid and describedBy.
 *
 * @param {Object}   props
 * @param {string}   [props.id]              the control's id
 * @param {*}        props.value             the option value or null; an array with multiple
 * @param {Function} props.onChange          single: (value, option|null), null when cleared, option null when
 *                                           created; multiple: (values)
 * @param {Object[]} [props.options]         { value, label, disabled, ...data }
 * @param {boolean}  [props.multiple]
 * @param {boolean}  [props.creatable]
 * @param {boolean}  [props.clearable]       single: a clear button (and Backspace or Delete on the button)
 * @param {boolean}  [props.searchable]      single: the search box, true by default
 * @param {boolean}  [props.loading]         shows "loading" instead of the empty text
 * @param {string}   [props.placeholder]
 * @param {boolean}  [props.disabled]
 * @param {boolean}  [props.readOnly]        no opening, no chip remove buttons
 * @param {Function} [props.renderOption]    (option) => the row in the list
 * @param {Function} [props.getOptionLabel]  (option) => label, for filtering and display
 * @param {Function} [props.getOptionValue]  (option) => its value
 * @param {string|Function} [props.emptyText]   or (query) => text
 * @param {string|Function} [props.createText]  or (query) => text
 * @param {Function} [props.isValidNew]      (query, values) => whether a typed value may be added
 * @param {Function} [props.normalize]       multiple: (entry) => the form two entries are compared in
 * @param {Object}   [props.commitRef]       multiple and creatable: its current is set to () => refused parts, which
 *                                           adds the typed text as values (as Enter does) for a save
 * @param {Function} [props.onQueryChange]   multiple: (text) after the typed text changed
 * @param {boolean}  [props.invalid]
 * @param {string}   [props.describedBy]
 * @param {Function} [props.onBlur]
 * @param {string}   [props.name]            a hidden input with the value (comma separated with multiple)
 * @param {*}        [props.ref]             the button or the input
 * @param {string}   [props.className]       of the wrapper
 */
export function Combobox({
	id,
	ref,
	value,
	onChange,
	options = [],
	multiple = false,
	creatable = false,
	clearable = false,
	searchable = true,
	loading = false,
	placeholder,
	disabled = false,
	readOnly = false,
	renderOption,
	getOptionLabel = defaultLabel,
	getOptionValue = defaultValue,
	emptyText,
	createText,
	isValidNew,
	normalize = defaultNormalize,
	commitRef,
	onQueryChange,
	invalid,
	describedBy,
	onBlur,
	name,
	className,
	...rest
}) {
	const ownId = useId();
	// the control itself, for focusing it after a chip is removed; ref also goes to the caller (react-hook-form)
	const focusRef = useRef(null);
	const inputRef = useCallback(
		(node) => {
			focusRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref],
	);
	const aria = {
		...rest,
		"aria-invalid": invalid ? "true" : rest["aria-invalid"],
		"aria-describedby": joinIds(rest["aria-describedby"], describedBy),
	};
	const shared = {
		id: id ?? ownId,
		inputRef,
		focusRef,
		onChange,
		options,
		creatable,
		placeholder,
		disabled,
		readOnly,
		loading,
		renderOption,
		getOptionLabel,
		getOptionValue,
		emptyText,
		createText,
		isValidNew,
		onBlur,
		aria,
		className,
	};
	const hidden = multiple ? (Array.isArray(value) ? value.join(",") : "") : isEmptyValue(value) ? "" : String(value);
	return (
		<>
			{multiple ? (
				<MultipleCombobox
					{...shared}
					value={value}
					normalize={normalize}
					commitRef={commitRef}
					onQueryChange={onQueryChange}
				/>
			) : (
				<SingleCombobox {...shared} value={value} clearable={clearable} searchable={searchable} />
			)}
			{name ? <input type="hidden" name={name} value={hidden} /> : null}
		</>
	);
}
