import { FileKey, RefreshCw, ServerCog, Zap } from "lucide-react";
import { useController, useFormContext } from "react-hook-form";
import { useIntl } from "react-intl";
import { FormField, SettingBadge, SwitchField, TextField, useFieldError } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "src/components/ui/input-group";
import { T } from "src/locale";
import { LockedBadge, LockReason } from "../Authentication/LockedBadge";
import { useRuntimeSection } from "./RuntimeSection";

const idOf = (name) => `runtime-${name}`;

// one icon per kind of "applies" note (settings.runtime.applies.*)
const APPLIES_ICONS = {
	"settings.runtime.applies.immediately": Zap,
	"settings.runtime.applies.next-certificate": FileKey,
	"settings.runtime.applies.reload": ServerCog,
};

/**
 * The badges under a setting's label: set by an env var (or locked by another setting), restart required, and when
 * a saved change takes effect; null when none applies
 */
function useFieldBadges(name) {
	const { formatMessage } = useIntl();
	const { isLocked, envOf, reasonOf, isRestart, appliesId } = useRuntimeSection();
	const applies = appliesId(name);
	const badges = [];
	if (isLocked(name)) badges.push(<LockedBadge key="lock" env={envOf(name)} reason={reasonOf(name)} />);
	if (isRestart(name))
		badges.push(
			<SettingBadge
				key="restart"
				icon={RefreshCw}
				description={formatMessage({ id: "settings.runtime.restart-required.hint" })}
			>
				<T id="settings.runtime.restart-required" />
			</SettingBadge>,
		);
	if (applies)
		badges.push(
			<SettingBadge key="applies" icon={APPLIES_ICONS[applies]} description={formatMessage({ id: applies })}>
				<T id={`${applies}.short`} />
			</SettingBadge>,
		);
	return badges.length > 0 ? badges : null;
}

/**
 * The field hint and, for a setting locked by another setting's env var, why (one sentence); null when there is
 * neither, so the field has no empty description for aria-describedby to point at
 */
function useFieldHint(name, hint) {
	const { isLocked, envOf, reasonOf } = useRuntimeSection();
	const reason = isLocked(name) ? reasonOf(name) : null;
	if (!(hint || reason)) return null;
	return (
		<>
			{hint}
			{reason ? (
				<span className="block">
					<LockReason env={envOf(name)} reason={reason} />
				</span>
			) : null}
		</>
	);
}

/**
 * A boolean setting as a switch line. `forced` shows it on and read-only (another
 * setting needs it), `forcedOff` shows it off and read-only (another setting rules it out); a controller, as the
 * switch may show another state than the field holds.
 */
function RuntimeSwitch({ name, label, hint, forced = false, forcedOff = false }) {
	const { field } = useController({ name });
	const { isLocked } = useRuntimeSection();
	const badges = useFieldBadges(name);
	const fieldHint = useFieldHint(name, hint);
	return (
		<SwitchField
			line
			id={idOf(name)}
			label={label}
			badges={badges}
			hint={fieldHint}
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
 * One setting as a line of the form layer's FormField: the label with its badges (lock, restart, applies) as the
 * line's name, the hint with when the change applies, the control on the right (inline) or under the name (block)
 *
 * @param {Object}   props
 * @param {string}   props.name
 * @param {*}        props.label
 * @param {*}        [props.hint]
 * @param {"inline"|"block"} [props.layout]  the control on the right (default) or under the name
 * @param {Function} props.children  (control) => the control, with FormField's id and aria attributes on it
 *   (aria-invalid gives it the red border)
 */
function RuntimeControl({ name, label, hint, layout = "inline", children }) {
	const error = useFieldError(name);
	const badges = useFieldBadges(name);
	const fieldHint = useFieldHint(name, hint);
	return (
		<FormField id={idOf(name)} line={layout} label={label} badges={badges} hint={fieldHint} error={error}>
			{children}
		</FormField>
	);
}

/**
 * Whole number with an optional unit (input group addon) as an inline line; the value stays text, as the input
 * holds it
 */
function RuntimeNumber({ name, label, hint, min, max, unit }) {
	const { register } = useFormContext();
	const { isLocked } = useRuntimeSection();
	return (
		<RuntimeControl name={name} label={label} hint={hint}>
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
 * Text input, or a textarea with rows (the form layer's TextField), as a line: a textarea or a URL goes under its
 * name (block), any other input on the right (inline), unless layout says otherwise
 */
function RuntimeText({ name, label, hint, placeholder, rows, type = "text", layout }) {
	const { isLocked } = useRuntimeSection();
	const badges = useFieldBadges(name);
	const fieldHint = useFieldHint(name, hint);
	return (
		<TextField
			name={name}
			id={idOf(name)}
			line={layout ?? (rows || type === "url" ? "block" : "inline")}
			label={label}
			badges={badges}
			hint={fieldHint}
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
function RuntimeSelect({ name, label, hint, options, onChange, layout = "inline" }) {
	const { field } = useController({ name });
	const { isLocked } = useRuntimeSection();
	return (
		<RuntimeControl name={name} label={label} hint={hint} layout={layout}>
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
