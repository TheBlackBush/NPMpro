import { IconRefresh } from "@tabler/icons-react";
import cn from "clsx";
import { Field, useFormikContext } from "formik";
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
 * A boolean setting as a Tabler settings switch row. `forced` shows it on and read-only (another setting needs it).
 */
function RuntimeSwitch({ name, label, hint, forced = false, className = "mb-3" }) {
	const { values, setFieldValue } = useFormikContext();
	const { isLocked } = useRuntimeSection();
	return (
		<SwitchField
			className={className}
			id={idOf(name)}
			label={<FieldLabel name={name}>{label}</FieldLabel>}
			hint={<FieldHint name={name} hint={hint} />}
			disabled={isLocked(name) || forced}
			checked={forced || Boolean(values[name])}
			onChange={(e) => setFieldValue(name, e.target.checked)}
		/>
	);
}

/**
 * Label, control, validation message and hint for one setting. `control(field, meta, props)` renders the input;
 * props carry id, disabled, the invalid class and the aria attributes.
 */
function RuntimeControl({ name, label, hint, control, validate, narrow = false, className = "mb-3" }) {
	const { isLocked } = useRuntimeSection();
	const id = idOf(name);
	const hintId = `${id}-hint`;
	return (
		<Field name={name} validate={validate}>
			{({ field, meta }) => {
				const invalid = Boolean(meta.error);
				const props = {
					id,
					disabled: isLocked(name),
					invalid,
					"aria-invalid": invalid ? "true" : undefined,
					"aria-describedby": hintId,
				};
				return (
					<div className={className}>
						<label className="form-label" htmlFor={id}>
							<FieldLabel name={name}>{label}</FieldLabel>
						</label>
						<div className="row">
							<div className={narrow ? "col-12 col-sm-6 col-lg-4" : "col-12"}>
								{control(field, meta, props)}
							</div>
						</div>
						<div className="form-hint" id={hintId}>
							<FieldHint name={name} hint={hint} />
						</div>
					</div>
				);
			}}
		</Field>
	);
}

const inputProps = ({ invalid, ...props }, extra) => ({
	...props,
	className: cn(extra, invalid && "is-invalid"),
});

/**
 * Whole number with an optional unit (input group)
 */
function RuntimeNumber({ name, label, hint, min, max, unit }) {
	return (
		<RuntimeControl
			name={name}
			label={label}
			hint={hint}
			narrow
			control={(field, meta, props) => (
				<div className={cn("input-group", meta.error && "has-validation")}>
					<input
						{...field}
						{...inputProps(props, "form-control")}
						type="number"
						inputMode="numeric"
						min={min}
						max={max}
						step={1}
					/>
					{unit ? <span className="input-group-text">{unit}</span> : null}
					{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
				</div>
			)}
		/>
	);
}

/**
 * Text input, or a textarea with rows
 */
function RuntimeText({ name, label, hint, placeholder, rows, validate, type = "text" }) {
	return (
		<RuntimeControl
			name={name}
			label={label}
			hint={hint}
			validate={validate}
			control={(field, meta, props) => (
				<>
					{rows ? (
						<textarea
							{...field}
							{...inputProps(props, "form-control font-monospace")}
							rows={rows}
							placeholder={placeholder}
							spellCheck={false}
							value={field.value ?? ""}
						/>
					) : (
						<input
							{...field}
							{...inputProps(props, "form-control")}
							type={type}
							autoComplete="off"
							spellCheck={false}
							placeholder={placeholder}
							value={field.value ?? ""}
						/>
					)}
					{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
				</>
			)}
		/>
	);
}

/**
 * Select of { value, label } options; onChange(value) replaces the default setter
 */
function RuntimeSelect({ name, label, hint, options, onChange, narrow = true }) {
	const { setFieldValue } = useFormikContext();
	return (
		<RuntimeControl
			name={name}
			label={label}
			hint={hint}
			narrow={narrow}
			control={(field, meta, props) => (
				<>
					<select
						{...field}
						{...inputProps(props, "form-select")}
						onChange={(e) => (onChange ? onChange(e.target.value) : setFieldValue(name, e.target.value))}
					>
						{options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
				</>
			)}
		/>
	);
}

export { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText };
