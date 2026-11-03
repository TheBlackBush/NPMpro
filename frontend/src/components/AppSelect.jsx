import { useCallback, useRef } from "react";
import { useController } from "react-hook-form";
import { useReadOnly } from "src/components/Form/HookForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "src/components/ui/select";
import { cn } from "src/lib/utils";
import { lastInput } from "src/modules/InputModality";
import { fromItemValue, toItemValue } from "src/modules/SelectOptions";

/**
 * A select on shadcn Select (Radix): the trigger looks like the other fields and the list is drawn by the app in the
 * theme's popover colours (a native select's list is drawn by the browser). Keyboard: Space, Enter or the arrow keys
 * open it, typing jumps to an option, Escape closes it.
 *
 * @param {Object}   props
 * @param {string|number} props.value
 * @param {(value: string) => void} props.onValueChange  the chosen option's value ("" for an empty one)
 * @param {{ value: string, label: *, disabled?: boolean }[]} props.options
 * @param {string}   [props.id]           of the trigger (a label's htmlFor)
 * @param {boolean}  [props.disabled]
 * @param {"default"|"sm"} [props.size]
 * @param {string}   [props.className]    of the trigger
 * @param {*}        [props.placeholder]  shown while no option matches the value
 * @param {Function} [props.onBlur]
 * @param {*}        [props.triggerRef]   gets the trigger (react-hook-form focuses it for "jump to the first error")
 * @param {string}   [props.name]         names the trigger, so form error notes find the field
 *   (aria-label, aria-describedby, aria-invalid, aria-required and data-* go to the trigger)
 */
function AppSelect({
	value,
	onValueChange,
	options,
	id,
	disabled,
	size = "default",
	className,
	placeholder,
	onBlur,
	triggerRef,
	name,
	...triggerProps
}) {
	// a value without an option (an unknown or empty sort) shows the placeholder: Radix shows it for ""
	const item = toItemValue(value);
	const selected = options.some((option) => toItemValue(option.value) === item) ? item : "";
	const trigger = useRef(null);
	const setTrigger = useCallback(
		(element) => {
			trigger.current = element;
			if (typeof triggerRef === "function") triggerRef(element);
			else if (triggerRef) triggerRef.current = element;
		},
		[triggerRef],
	);
	// After a pick with the pointer the focus goes back to the trigger, so Tab goes on from the field, but Chrome
	// would show that scripted focus as keyboard focus: the trigger is marked until it is left or a key is pressed
	const onCloseAutoFocus = (event) => {
		if (lastInput() === "keyboard") return;
		event.preventDefault();
		trigger.current?.setAttribute("data-pointer-focus", "");
		trigger.current?.focus({ preventScroll: true });
	};
	const clearPointerFocus = (event) => event.currentTarget.removeAttribute("data-pointer-focus");
	return (
		<Select value={selected} onValueChange={(item) => onValueChange(fromItemValue(item))} disabled={disabled}>
			<SelectTrigger
				id={id}
				name={name}
				ref={setTrigger}
				size={size}
				onBlur={(event) => {
					clearPointerFocus(event);
					onBlur?.(event);
				}}
				onKeyDown={clearPointerFocus}
				className={cn(
					"w-full data-pointer-focus:focus-visible:border-input data-pointer-focus:focus-visible:ring-0",
					className,
				)}
				{...triggerProps}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			{/* below the trigger and at least as wide, like a native select's list */}
			<SelectContent position="popper" onCloseAutoFocus={onCloseAutoFocus}>
				{options.map((option) => (
					<SelectItem key={option.value} value={toItemValue(option.value)} disabled={option.disabled}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * AppSelect bound to a react-hook-form field. registerOptions keeps the register() options callers used with a native
 * select: valueAsNumber stores numbers, onChange runs after the value changed with a change-event-like object
 * ({ target: { name, value } }, value as a string like a native select's)
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {{ valueAsNumber?: boolean, onChange?: Function }} [props.registerOptions]
 */
function FormSelect({ name, registerOptions = {}, disabled, ...selectProps }) {
	const { field } = useController({ name });
	// a View window's fieldset disables the trigger button, but Radix opens on pointerdown, which Chrome still sends to
	// a disabled button: the Select itself is disabled in a read-only form
	const readOnly = useReadOnly();
	const { valueAsNumber = false, onChange } = registerOptions;
	return (
		<AppSelect
			{...selectProps}
			disabled={disabled || readOnly}
			name={field.name}
			value={field.value}
			triggerRef={field.ref}
			onBlur={field.onBlur}
			onValueChange={(text) => {
				field.onChange(valueAsNumber ? fromItemValue(toItemValue(text), { valueAsNumber }) : text);
				onChange?.({ type: "change", target: { name: field.name, value: text } });
			}}
		/>
	);
}

export { AppSelect, FormSelect };
