import { controlAria, SWITCH_CLASS } from "src/modules/FormFields";
import { Field, FieldContent, FieldDescription, FieldLabel } from "src/ui/field";
import { FieldMessage } from "./FieldMessage";

/**
 * A settings row on shadcn's horizontal Field: the name (and an optional hint) on the left, a switch on the right. The
 * switch is a native checkbox drawn as shadcn's Switch (SWITCH_CLASS), so the caller's props (register(), checked and
 * onChange(event), disabled) work as before, and screen readers read it as the checkbox it was. It is described by its error and its hint; the error shows under the row.
 * A list of rows is a SwitchList.
 */
function SwitchField({ id, label, hint, error, className, ...inputProps }) {
	const aria = controlAria({ id, hasHint: Boolean(hint), error, describedBy: inputProps["aria-describedby"] });
	return (
		<div className={className}>
			<Field
				orientation="horizontal"
				data-invalid={error ? true : undefined}
				data-disabled={inputProps.disabled ? true : undefined}
				className="tw:[&:has(input:disabled)>[data-slot=field-content]]:opacity-50"
			>
				<FieldContent>
					<FieldLabel htmlFor={id} id={aria.labelId} className="tw:font-normal">
						{label}
					</FieldLabel>
					{hint ? <FieldDescription id={aria.hintId}>{hint}</FieldDescription> : null}
				</FieldContent>
				<input
					{...inputProps}
					id={id}
					type="checkbox"
					className={SWITCH_CLASS}
					aria-invalid={aria["aria-invalid"]}
					aria-describedby={aria["aria-describedby"]}
				/>
			</Field>
			{error ? (
				<FieldMessage id={aria.errorId} className="tw:mt-1">
					{error}
				</FieldMessage>
			) : null}
		</div>
	);
}

export { SwitchField };
