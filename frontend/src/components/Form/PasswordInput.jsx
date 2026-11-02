import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { intl } from "src/locale";
import { Field, FieldLabel } from "src/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "src/ui/input-group";
import { FieldMessage } from "./FieldMessage";

/**
 * A password input in shadcn's InputGroup with an eye button that shows or hides the text (aria-pressed tells which).
 *
 * @param {Object}  props
 * @param {boolean} [props.invalid]        the red border (aria-invalid on the input)
 * @param {string}  [props.className]      of the input
 */
function PasswordControl({ invalid = false, className, ...inputProps }) {
	const [visible, setVisible] = useState(false);
	return (
		<InputGroup>
			<InputGroupInput
				{...inputProps}
				type={visible ? "text" : "password"}
				aria-invalid={inputProps["aria-invalid"] ?? (invalid ? "true" : undefined)}
				className={className}
			/>
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					size="icon-xs"
					aria-label={intl.formatMessage({ id: "password.toggle-visibility" })}
					aria-pressed={visible}
					onClick={() => setVisible((v) => !v)}
				>
					{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}

/**
 * A labelled password input with its error (login and setup); forms on the layer use PasswordField.
 */
function PasswordInput({ id, label, error, ...inputProps }) {
	return (
		<Field data-invalid={error ? true : undefined}>
			{label ? <FieldLabel htmlFor={id}>{label}</FieldLabel> : null}
			<PasswordControl
				{...inputProps}
				id={id}
				invalid={Boolean(error)}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={
					[error && `${id}-error`, inputProps["aria-describedby"]].filter(Boolean).join(" ") || undefined
				}
			/>
			{error ? <FieldMessage id={`${id}-error`}>{error}</FieldMessage> : null}
		</Field>
	);
}

export { PasswordControl, PasswordInput };
