import { IconEye, IconEyeOff } from "@tabler/icons-react";
import cn from "clsx";
import { useState } from "react";
import { intl } from "src/locale";

/**
 * A password input with Tabler's flat input group and an eye button that shows or hides the text. children go
 * inside the group, after the button (PasswordInput's error).
 *
 * @param {Object}  props
 * @param {boolean} [props.invalid]        the red border (is-invalid)
 * @param {string}  [props.className]      of the input
 * @param {boolean} [props.textWhenEmpty]  plain text while empty, so the placeholder shows as typed text
 * @param {*}       [props.children]
 */
function PasswordControl({ invalid = false, className, textWhenEmpty, children, ...inputProps }) {
	const [visible, setVisible] = useState(false);
	const asText = Boolean(visible || (textWhenEmpty && !inputProps.value));
	return (
		<div className={cn("input-group input-group-flat", invalid && children && "has-validation")}>
			<input
				{...inputProps}
				type={asText ? "text" : "password"}
				className={cn("form-control", invalid && "is-invalid", className)}
			/>
			<span className="input-group-text py-0">
				<button
					type="button"
					className="btn btn-icon btn-ghost btn-sm"
					aria-label={intl.formatMessage({ id: "password.toggle-visibility" })}
					aria-pressed={asText}
					onClick={() => setVisible((v) => !v)}
				>
					{asText ? (
						<IconEyeOff className="icon" aria-hidden="true" />
					) : (
						<IconEye className="icon" aria-hidden="true" />
					)}
				</button>
			</span>
			{children}
		</div>
	);
}

/**
 * A labelled password input with its error inside the group (login and setup); forms on the layer use
 * PasswordField
 */
function PasswordInput({ id, label, error, ...inputProps }) {
	return (
		<>
			{label ? (
				<label className="form-label" htmlFor={id}>
					{label}
				</label>
			) : null}
			<PasswordControl
				{...inputProps}
				id={id}
				invalid={Boolean(error)}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={cn(error && `${id}-error`, inputProps["aria-describedby"]) || undefined}
			>
				{error ? (
					<div className="invalid-feedback" id={`${id}-error`}>
						{error}
					</div>
				) : null}
			</PasswordControl>
		</>
	);
}

export { PasswordControl, PasswordInput };
