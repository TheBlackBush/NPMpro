import { IconEye, IconEyeOff } from "@tabler/icons-react";
import cn from "clsx";
import { useState } from "react";
import { intl } from "src/locale";

function PasswordInput({ id, label, error, className, textWhenEmpty, ...inputProps }) {
	const [visible, setVisible] = useState(false);
	const asText = Boolean(visible || (textWhenEmpty && !inputProps.value));
	return (
		<>
			{label ? (
				<label className="form-label" htmlFor={id}>
					{label}
				</label>
			) : null}
			<div className={cn("input-group input-group-flat", error && "has-validation")}>
				<input
					{...inputProps}
					id={id}
					aria-invalid={error ? "true" : undefined}
					aria-describedby={cn(error && `${id}-error`, inputProps["aria-describedby"]) || undefined}
					type={asText ? "text" : "password"}
					className={cn("form-control", error && "is-invalid", className)}
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
				{error ? (
					<div className="invalid-feedback" id={`${id}-error`}>
						{error}
					</div>
				) : null}
			</div>
		</>
	);
}

export { PasswordInput };
