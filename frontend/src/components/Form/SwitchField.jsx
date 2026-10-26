import cn from "clsx";

/**
 * Tabler settings row: text (and an optional hint) on the left, a switch on the right
 * (https://preview.tabler.io/form-elements.html, "Notification" fieldset). error: shown under the row.
 */
function SwitchField({ id, label, hint, error, className, ...inputProps }) {
	const errorId = `${id}-error`;
	return (
		<div className={className}>
			<label className={cn("row", inputProps.disabled ? null : "cursor-pointer")} htmlFor={id}>
				<span className="col">
					{label}
					{hint ? <span className="form-hint d-block">{hint}</span> : null}
				</span>
				<span className="col-auto">
					<span className="form-check form-check-single form-switch">
						<input
							{...inputProps}
							id={id}
							className={cn("form-check-input", error && "is-invalid")}
							type="checkbox"
							aria-invalid={error ? "true" : undefined}
							aria-describedby={error ? errorId : inputProps["aria-describedby"]}
						/>
					</span>
				</span>
			</label>
			{error ? (
				<div className="invalid-feedback d-block" id={errorId}>
					{error}
				</div>
			) : null}
		</div>
	);
}

export { SwitchField };
