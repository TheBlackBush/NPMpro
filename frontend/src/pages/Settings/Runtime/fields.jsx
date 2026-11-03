import { RefreshCw } from "lucide-react";
import { useController, useFormContext } from "react-hook-form";
import { FormField, SwitchField, TextField, useFieldError } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import { Badge } from "src/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "src/components/ui/input-group";
import { T } from "src/locale";
import { LockedBadge, LockReason } from "../Authentication/LockedBadge";
import { useRuntimeSection } from "./RuntimeSection";

const idOf = (name) => `runtime-${name}`;

/**
 * The badge of a setting that applies after a container restart
 */
function RestartBadge() {
	return (
		<Badge variant="outline" className="ms-2 h-auto whitespace-normal py-0.5 text-left">
			<RefreshCw aria-hidden="true" />
			<T id="settings.runtime.restart-required" />
		</Badge>
	);
}

/**
 * Label text with the lock badge when the key is locked ("Set by <ENV>", or the wording of an indirect lock), else
 * the Restart required badge for a setting that applies after a container restart
 */
function FieldLabel({ name, children }) {
	const { isLocked, envOf, reasonOf, isRestart } = useRuntimeSection();
	let badge = null;
	if (isLocked(name)) badge = <LockedBadge env={envOf(name)} reason={reasonOf(name)} />;
	else if (isRestart(name)) badge = <RestartBadge />;
	return (
		<>
			{children}
			{badge}
		</>
	);
}

/**
 * The field hint, why another setting locks it (indirect lock) and when a change takes effect (restart settings show
 * their badge instead, a pending restart shows at the top of the section)
 */
function FieldHint({ name, hint }) {
	const { appliesId, isLocked, envOf, reasonOf } = useRuntimeSection();
	const applies = appliesId(name);
	const reason = isLocked(name) ? reasonOf(name) : null;
	return (
		<>
			{hint}
			{reason ? (
				<span className="block text-sm text-muted-foreground">
					<LockReason env={envOf(name)} reason={reason} />
				</span>
			) : null}
			{applies ? (
				<span className="block text-sm text-muted-foreground">
					<T id={applies} />
				</span>
			) : null}
		</>
	);
}

/**
 * A boolean setting as a Tabler settings switch row, for a SwitchList. `forced` shows it on and read-only (another
 * setting needs it), `forcedOff` shows it off and read-only (another setting rules it out); a controller, as the
 * switch may show another state than the field holds.
 */
function RuntimeSwitch({ name, label, hint, forced = false, forcedOff = false }) {
	const { field } = useController({ name });
	const { isLocked } = useRuntimeSection();
	return (
		<SwitchField
			id={idOf(name)}
			label={<FieldLabel name={name}>{label}</FieldLabel>}
			hint={<FieldHint name={name} hint={hint} />}
			name={field.name}
			ref={field.ref}
			onBlur={field.onBlur}
			disabled={isLocked(name) || forced || forcedOff}
			checked={forced || (!forcedOff && Boolean(field.value))}
			onChange={(e) => field.onChange(e.target.checked)}
		/>
	);
}

/**
 * One setting on the form layer's FormField: the label with its lock or restart badge, the control (narrow: a third
 * of the row from lg, half from sm), the error and the hint with when the change applies
 *
 * @param {Object}   props
 * @param {string}   props.name
 * @param {*}        props.label
 * @param {*}        [props.hint]
 * @param {boolean}  [props.narrow]
 * @param {string}   [props.className]  the field's wrapper class, `mb-3` by default; "" for the last field of a group
 * @param {Function} props.children  (control) => the control, with FormField's id and aria attributes on it
 *   (aria-invalid gives it the red border)
 */
function RuntimeControl({ name, label, hint, narrow = false, className, children }) {
	const error = useFieldError(name);
	return (
		<FormField
			id={idOf(name)}
			label={<FieldLabel name={name}>{label}</FieldLabel>}
			hint={<FieldHint name={name} hint={hint} />}
			error={error}
			className={className}
		>
			{(control) =>
				narrow ? <div className="w-full sm:w-1/2 lg:w-1/3">{children(control)}</div> : children(control)
			}
		</FormField>
	);
}

/**
 * Whole number with an optional unit (input group addon); the value stays text, as the input holds it
 */
function RuntimeNumber({ name, label, hint, min, max, unit, className }) {
	const { register } = useFormContext();
	const { isLocked } = useRuntimeSection();
	return (
		<RuntimeControl name={name} label={label} hint={hint} narrow className={className}>
			{(control) => (
				<InputGroup data-disabled={isLocked(name) || undefined}>
					<InputGroupInput
						{...register(name)}
						{...control}
						disabled={isLocked(name)}
						type="number"
						inputMode="numeric"
						min={min}
						max={max}
						step={1}
					/>
					{unit ? (
						<InputGroupAddon align="inline-end">
							<InputGroupText>{unit}</InputGroupText>
						</InputGroupAddon>
					) : null}
				</InputGroup>
			)}
		</RuntimeControl>
	);
}

/**
 * Text input, or a textarea with rows (the form layer's TextField)
 */
function RuntimeText({ name, label, hint, placeholder, rows, type = "text", className }) {
	const { isLocked } = useRuntimeSection();
	return (
		<TextField
			name={name}
			className={className}
			id={idOf(name)}
			label={<FieldLabel name={name}>{label}</FieldLabel>}
			hint={<FieldHint name={name} hint={hint} />}
			as={rows ? "textarea" : "input"}
			controlClassName={rows ? "font-mono" : undefined}
			disabled={isLocked(name)}
			rows={rows}
			type={rows ? undefined : type}
			autoComplete={rows ? undefined : "off"}
			spellCheck={false}
			placeholder={placeholder}
		/>
	);
}

/**
 * Select of { value, label } options on AppSelect; onChange(value) runs after the field took the new value (for
 * fields that follow it), the value a string as a native select gives it. A controller: the options may change while
 * the form is open (key sizes follow the key type, the certificates load later), and the shown option must follow the
 * value.
 */
function RuntimeSelect({ name, label, hint, options, onChange, narrow = true, className }) {
	const { field } = useController({ name });
	const { isLocked } = useRuntimeSection();
	return (
		<RuntimeControl name={name} label={label} hint={hint} narrow={narrow} className={className}>
			{(control) => (
				<AppSelect
					{...control}
					disabled={isLocked(name)}
					name={field.name}
					triggerRef={field.ref}
					value={field.value}
					onBlur={field.onBlur}
					onValueChange={(value) => {
						field.onChange(value);
						onChange?.(value);
					}}
					options={options}
				/>
			)}
		</RuntimeControl>
	);
}

export { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText };
