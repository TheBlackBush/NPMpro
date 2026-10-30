import cn from "clsx";
import { useLayoutEffect } from "react";
import { useFormContext } from "react-hook-form";
import { components } from "react-select";
import { controlAria, joinIds, labelClass } from "src/modules/FormFields";
import { useFieldError } from "./HookForm";
import { PasswordControl } from "./PasswordInput";

/**
 * One field as Tabler's form elements: the label (Tabler's red asterisk when required), the control, the error
 * (invalid-feedback) and the hint (form-hint), with stable ids. The control is described by the error and the hint
 * together (the error never replaces the hint) and marked invalid while the error shows.
 *
 * @param {Object}      props
 * @param {string}      props.id             the control's id
 * @param {*}           [props.label]
 * @param {boolean}     [props.required]     the asterisk; the control takes the required attribute itself
 * @param {*}           [props.hint]
 * @param {string|null} [props.error]        the message that shows
 * @param {string}      [props.describedBy]  more ids that describe the control
 * @param {string}      [props.className]    of the wrapper, "mb-3" by default
 * @param {Function}    props.children       (control) => the control, with control = { id, aria-invalid,
 *                                           aria-describedby } to spread on it
 */
function FormField({ id, label, required = false, hint, error = null, describedBy, className = "mb-3", children }) {
	const aria = controlAria({ id, hasHint: Boolean(hint), error, describedBy });
	return (
		<div className={className}>
			{label ? (
				<label className={labelClass(required)} htmlFor={id} id={aria.labelId}>
					{label}
				</label>
			) : null}
			{children({ id, "aria-invalid": aria["aria-invalid"], "aria-describedby": aria["aria-describedby"] })}
			{error ? (
				<div className="invalid-feedback d-block" id={aria.errorId}>
					{error}
				</div>
			) : null}
			{hint ? (
				<div className="form-hint" id={aria.hintId}>
					{hint}
				</div>
			) : null}
		</div>
	);
}

/**
 * A text input or textarea of the form around it (register), on FormField
 *
 * @param {Object}  props
 * @param {string}  props.name
 * @param {string}  [props.id]                 the name by default
 * @param {*}       [props.label]
 * @param {boolean} [props.required]
 * @param {*}       [props.hint]
 * @param {string}  [props.describedBy]
 * @param {string}  [props.className]          of the field
 * @param {Object}  [props.registerOptions]    register's options (onChange, setValueAs)
 * @param {"input"|"textarea"} [props.as]
 * @param {string}  [props.controlClassName]   more classes of the control (font-monospace)
 * @param {Object}  props.controlProps         the rest goes to the control (type, autoComplete, placeholder, ...)
 */
function TextField({
	name,
	id = name,
	label,
	required = false,
	hint,
	describedBy,
	className,
	registerOptions,
	as: Control = "input",
	controlClassName,
	...controlProps
}) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	return (
		<FormField
			id={id}
			label={label}
			required={required}
			hint={hint}
			error={error}
			describedBy={describedBy}
			className={className}
		>
			{(control) => (
				<Control
					{...controlProps}
					{...register(name, registerOptions)}
					{...control}
					required={required}
					className={cn("form-control", error && "is-invalid", controlClassName)}
				/>
			)}
		</FormField>
	);
}

/**
 * A native select of the form around it (register), on FormField; children are its options
 */
function SelectField({
	name,
	id = name,
	label,
	required = false,
	hint,
	describedBy,
	className,
	registerOptions,
	children,
	...selectProps
}) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	return (
		<FormField
			id={id}
			label={label}
			required={required}
			hint={hint}
			error={error}
			describedBy={describedBy}
			className={className}
		>
			{(control) => (
				<select
					{...selectProps}
					{...register(name, registerOptions)}
					{...control}
					required={required}
					className={cn("form-select", error && "is-invalid")}
				>
					{children}
				</select>
			)}
		</FormField>
	);
}

/**
 * A password input of the form around it (register), with the eye button, on FormField. label may hold more than
 * the text (a lock badge).
 */
function PasswordField({
	name,
	id = name,
	label,
	required = false,
	hint,
	describedBy,
	className,
	registerOptions,
	...inputProps
}) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	return (
		<FormField
			id={id}
			label={label}
			required={required}
			hint={hint}
			error={error}
			describedBy={describedBy}
			className={className}
		>
			{(control) => (
				<PasswordControl
					{...inputProps}
					{...register(name, registerOptions)}
					{...control}
					required={required}
					invalid={Boolean(error)}
				/>
			)}
		</FormField>
	);
}

// react-select's input, described like a field's control: react-select ignores an aria-describedby prop and sets
// its own (the placeholder, the live region), so the field's ids come in as selectProps.describedBy and are joined
function DescribedSelectInput(props) {
	return (
		<components.Input
			{...props}
			aria-describedby={joinIds(props["aria-describedby"], props.selectProps.describedBy)}
		/>
	);
}

// With isSearchable={false} react-select renders its own DummyInput, which no component can replace and which
// takes the same react-select owned aria-describedby. The Control is rendered in both cases: after each render it
// joins the field's ids onto that input (the same ids, so React and this agree on what is joined).
function DescribedSelectControl(props) {
	const { describedBy, inputId, isSearchable } = props.selectProps;
	useLayoutEffect(() => {
		if (isSearchable !== false || !describedBy || !inputId) return;
		const input = document.getElementById(inputId);
		const joined = joinIds(input?.getAttribute("aria-describedby"), describedBy);
		if (input && joined) input.setAttribute("aria-describedby", joined);
	});
	return <components.Control {...props} />;
}

/**
 * The props that make a react-select the control of a FormField: its input takes the field's id (the label points
 * at it), invalid and described like any control. The caller's own react-select components are kept (Option,
 * MenuList, ...); only Input (and Control, unless the caller gives one) are the field's.
 *
 * @param   {Object} control       FormField's control argument
 * @param   {Object} [overrides]   the caller's react-select components
 * @returns {Object}  inputId, aria-invalid, describedBy, components
 */
function selectControlProps(control, overrides) {
	return {
		inputId: control.id,
		"aria-invalid": control["aria-invalid"],
		describedBy: control["aria-describedby"],
		components: { Control: DescribedSelectControl, ...overrides, Input: DescribedSelectInput },
	};
}

export { FormField, PasswordField, SelectField, selectControlProps, TextField };
