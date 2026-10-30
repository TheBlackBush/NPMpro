import { IconRefresh } from "@tabler/icons-react";
import cn from "clsx";
import { useController, useFormContext, useFormState } from "react-hook-form";
import { SwitchField } from "src/components";
import { T } from "src/locale";
import { LockedBadge, LockReason } from "../Authentication/LockedBadge";
import { useRuntimeSection } from "./RuntimeSection";

const idOf = (name) => `runtime-${name}`;

/**
 * The badge of a setting that applies after a container restart
 */
function RestartBadge() {
	return (
		<span className="badge bg-orange-lt ms-2 text-wrap">
			<IconRefresh className="icon me-1" aria-hidden="true" />
			<T id="settings.runtime.restart-required" />
		</span>
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
				<span className="d-block">
					<LockReason env={envOf(name)} reason={reason} />
				</span>
			) : null}
			{applies ? (
				<span className="d-block">
					<T id={applies} />
				</span>
			) : null}
		</>
	);
}

/**
 * A boolean setting as a Tabler settings switch row. `forced` shows it on and read-only (another setting needs it),
 * `forcedOff` shows it off and read-only (another setting rules it out); a controller, as the switch may show another
 * state than the field holds.
 */
function RuntimeSwitch({ name, label, hint, forced = false, forcedOff = false, className = "mb-3" }) {
	const { field } = useController({ name });
	const { isLocked } = useRuntimeSection();
	return (
		<SwitchField
			className={className}
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
 * The message a setting shows (React Hook Form's error of the field) and the attributes of its control: id, disabled
 * while locked, the invalid class and the aria attributes
 *
 * @param   {string} name
 * @param   {string} className  the control's class (form-control, form-select)
 * @returns {{ error: ?string, props: Object }}
 */
function useControlProps(name, className) {
	const { isLocked } = useRuntimeSection();
	const { errors } = useFormState({ name, exact: true });
	const error = errors[name]?.message ?? null;
	const id = idOf(name);
	return {
		error,
		props: {
			id,
			disabled: isLocked(name),
			className: cn(className, error && "is-invalid"),
			"aria-invalid": error ? "true" : undefined,
			"aria-describedby": `${id}-hint`,
		},
	};
}

/**
 * Label, control, validation message and hint for one setting (children: the control and its message)
 */
function RuntimeControl({ name, label, hint, narrow = false, className = "mb-3", children }) {
	const id = idOf(name);
	return (
		<div className={className}>
			<label className="form-label" htmlFor={id}>
				<FieldLabel name={name}>{label}</FieldLabel>
			</label>
			<div className="row">
				<div className={narrow ? "col-12 col-sm-6 col-lg-4" : "col-12"}>{children}</div>
			</div>
			<div className="form-hint" id={`${id}-hint`}>
				<FieldHint name={name} hint={hint} />
			</div>
		</div>
	);
}

/**
 * Whole number with an optional unit (input group); the value stays text, as the input holds it
 */
function RuntimeNumber({ name, label, hint, min, max, unit }) {
	const { register } = useFormContext();
	const { error, props } = useControlProps(name, "form-control");
	return (
		<RuntimeControl name={name} label={label} hint={hint} narrow>
			<div className={cn("input-group", error && "has-validation")}>
				<input {...register(name)} {...props} type="number" inputMode="numeric" min={min} max={max} step={1} />
				{unit ? <span className="input-group-text">{unit}</span> : null}
				{error ? <div className="invalid-feedback">{error}</div> : null}
			</div>
		</RuntimeControl>
	);
}

/**
 * Text input, or a textarea with rows
 */
function RuntimeText({ name, label, hint, placeholder, rows, type = "text" }) {
	const { register } = useFormContext();
	const { error, props } = useControlProps(name, rows ? "form-control font-monospace" : "form-control");
	return (
		<RuntimeControl name={name} label={label} hint={hint}>
			{rows ? (
				<textarea {...register(name)} {...props} rows={rows} placeholder={placeholder} spellCheck={false} />
			) : (
				<input
					{...register(name)}
					{...props}
					type={type}
					autoComplete="off"
					spellCheck={false}
					placeholder={placeholder}
				/>
			)}
			{error ? <div className="invalid-feedback">{error}</div> : null}
		</RuntimeControl>
	);
}

/**
 * Select of { value, label } options; onChange(value) runs after the field took the new value (for fields that
 * follow it). A controller: the options may change while the form is open (key sizes follow the key type, the
 * certificates load later), and the shown option must follow the value.
 */
function RuntimeSelect({ name, label, hint, options, onChange, narrow = true }) {
	const { field } = useController({ name });
	const { error, props } = useControlProps(name, "form-select");
	return (
		<RuntimeControl name={name} label={label} hint={hint} narrow={narrow}>
			<select
				{...props}
				name={field.name}
				ref={field.ref}
				value={field.value}
				onBlur={field.onBlur}
				onChange={(e) => {
					field.onChange(e.target.value);
					onChange?.(e.target.value);
				}}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{error ? <div className="invalid-feedback">{error}</div> : null}
		</RuntimeControl>
	);
}

export { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText };
