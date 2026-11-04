import { Children } from "react";
import { useFormContext } from "react-hook-form";
import { FormSelect } from "src/components/AppSelect";
import { Field, FieldDescription, FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { Textarea } from "src/components/ui/textarea";
import { cn } from "src/lib/utils";
import { controlAria } from "src/modules/FormFields";
import { optionsFromElements } from "src/modules/SelectOptions";
import { FieldMessage } from "./FieldMessage";
import { useFieldError, useReadOnly } from "./HookForm";
import { PasswordControl } from "./PasswordInput";
import { SettingBadges } from "./SettingBadge";
import { useBadgesFit } from "./useBadgesFit";

/**
 * One field on shadcn's Field: the label (a red asterisk, hidden from screen readers, when required), the control,
 * the error and the hint, with stable ids. The control is described by the error and the hint together (the error
 * never replaces the hint), marked invalid while the error shows and aria-required when required.
 *
 * @param {Object}      props
 * @param {string}      props.id             the control's id
 * @param {*}           [props.label]
 * @param {boolean}     [props.required]     the asterisk; the control takes the required attribute itself
 * @param {*}           [props.hint]
 * @param {*}           [props.badges]       lock, restart and applies badges: beside the label when they fit, else
 *                                           at the bottom after the hint; they describe the control
 * @param {string|null} [props.error]        the message that shows
 * @param {string}      [props.describedBy]  more ids that describe the control
 * @param {string}      [props.className]    of the wrapper, "mb-3" by default
 * @param {Function}    [props.onLabelClick] of the label (onClick); a select passes one that focuses its trigger
 *                                           instead of letting the label open the list
 * @param {Function}    props.children       (control) => the control, with control = { id, aria-invalid,
 *                                           aria-describedby, aria-required } to spread on it
 */
function FormField({
	id,
	label,
	required = false,
	hint,
	badges,
	error = null,
	describedBy,
	className = "mb-3",
	onLabelClick,
	children,
}) {
	const hasBadges = Children.toArray(badges).length > 0;
	const aria = controlAria({ id, hasHint: Boolean(hint), hasBadges, error, describedBy });
	// a read-only form (a window opened to view) asks for nothing, so it shows no required marks
	const readOnly = useReadOnly();
	const { inline, rowRef, labelRef, badgesRef } = useBadgesFit({ enabled: hasBadges && Boolean(label) });
	const badgesRow = hasBadges ? (
		<SettingBadges id={aria.badgesId} ref={badgesRef}>
			{badges}
		</SettingBadges>
	) : null;
	const labelNode = label ? (
		<FieldLabel htmlFor={id} id={aria.labelId} onClick={onLabelClick} ref={labelRef}>
			{label}
			{required && !readOnly ? (
				<span aria-hidden="true" className="text-destructive" data-slot="required-mark">
					*
				</span>
			) : null}
		</FieldLabel>
	) : null;
	return (
		// no group role: the label already names the control, a named group around it only adds noise
		<Field role="none" className={className} data-invalid={error ? true : undefined}>
			{hasBadges && label ? (
				// badges beside the label when both fit the row, else at the bottom of the setting after the hint
				<div ref={rowRef} className="flex items-center gap-2">
					{labelNode}
					{inline ? badgesRow : null}
				</div>
			) : (
				labelNode
			)}
			{children({
				id,
				"aria-invalid": aria["aria-invalid"],
				"aria-describedby": aria["aria-describedby"],
				"aria-required": required ? "true" : undefined,
			})}
			{error ? <FieldMessage id={aria.errorId}>{error}</FieldMessage> : null}
			{hint ? <FieldDescription id={aria.hintId}>{hint}</FieldDescription> : null}
			{inline ? null : badgesRow}
		</Field>
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
 * @param {*}       [props.badges]
 * @param {string}  [props.describedBy]
 * @param {string}  [props.className]          of the field
 * @param {Object}  [props.registerOptions]    register's options (onChange, setValueAs)
 * @param {"input"|"textarea"} [props.as]
 * @param {string}  [props.controlClassName]   more classes of the control (font-mono)
 * @param {Object}  props.controlProps         the rest goes to the control (type, autoComplete, placeholder, ...)
 */
function TextField({
	name,
	id = name,
	label,
	required = false,
	hint,
	badges,
	describedBy,
	className,
	registerOptions,
	as = "input",
	controlClassName,
	...controlProps
}) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	const Control = as === "textarea" ? Textarea : Input;
	return (
		<FormField
			id={id}
			label={label}
			required={required}
			hint={hint}
			badges={badges}
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
					// a textarea keeps the rows it is given (Textarea grows with its content by default)
					className={cn(as === "textarea" && "field-sizing-fixed", controlClassName)}
				/>
			)}
		</FormField>
	);
}

/**
 * A select of the form around it (shadcn Select bound with useController), on FormField; children are <option>
 * elements as for a native select. registerOptions: valueAsNumber and onChange as with register
 */
function SelectField({
	name,
	id = name,
	label,
	required = false,
	hint,
	badges,
	describedBy,
	className,
	registerOptions,
	children,
	...selectProps
}) {
	const error = useFieldError(name);
	// callers write <option> children as for a native select; the Select draws them as its items
	const options = optionsFromElements(Children.toArray(children));
	return (
		<FormField
			id={id}
			label={label}
			required={required}
			hint={hint}
			badges={badges}
			error={error}
			describedBy={describedBy}
			className={className}
			// a click on the label focuses the trigger (Space or Enter then opens the list), it does not open it
			onLabelClick={(event) => {
				event.preventDefault();
				document.getElementById(id)?.focus();
			}}
		>
			{(control) => (
				<FormSelect
					{...selectProps}
					{...control}
					name={name}
					registerOptions={registerOptions}
					options={options}
					aria-required={required || undefined}
				/>
			)}
		</FormField>
	);
}

/**
 * A password input of the form around it (register), with the eye button, on FormField. badges hold the lock badge.
 */
function PasswordField({
	name,
	id = name,
	label,
	required = false,
	hint,
	badges,
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
			badges={badges}
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

export { FormField, PasswordField, SelectField, TextField };
