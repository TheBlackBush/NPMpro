import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { Field, FieldError, FieldLabel } from "src/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "src/components/ui/input-group";
import { intl } from "src/locale";
import { joinIds } from "src/modules/FormFields";

/**
 * A password input in an input group with an eye button that shows or hides the text.
 *
 * @param {Object}  props
 * @param {boolean} [props.invalid]        the invalid state (the control takes aria-invalid itself)
 * @param {string}  [props.className]      of the input
 */
function PasswordControl({ invalid = false, className, ...inputProps }) {
	const [visible, setVisible] = useState(false);
	return (
		<InputGroup>
			<InputGroupInput
				{...inputProps}
				type={visible ? "text" : "password"}
				aria-invalid={invalid ? "true" : inputProps["aria-invalid"]}
				className={className}
			/>
			<InputGroupAddon align="inline-end">
				<InputGroupButton
					size="icon-xs"
					aria-label={intl.formatMessage({ id: "password.toggle-visibility" })}
					aria-pressed={visible}
					onClick={() => setVisible((v) => !v)}
				>
					{visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
				</InputGroupButton>
			</InputGroupAddon>
		</InputGroup>
	);
}

/**
 * A labelled password input with its error under it (login and setup); forms on the layer use PasswordField.
 */
function PasswordInput({ id, label, error, ...inputProps }) {
	return (
		<Field data-invalid={error ? true : undefined}>
			{label ? <FieldLabel htmlFor={id}>{label}</FieldLabel> : null}
			<PasswordControl
				{...inputProps}
				id={id}
				invalid={Boolean(error)}
				aria-describedby={joinIds(error ? `${id}-error` : null, inputProps["aria-describedby"])}
			/>
			{error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
		</Field>
	);
}

export { PasswordControl, PasswordInput };
