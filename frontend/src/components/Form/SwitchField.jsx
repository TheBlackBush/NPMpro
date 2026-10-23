import cn from "clsx";

/**
 * Tabler settings row: text (and an optional hint) on the left, a switch on the right
 * (https://preview.tabler.io/form-elements.html, "Notification" fieldset).
 */
function SwitchField({ id, label, hint, className, ...inputProps }) {
	return (
		<label className={cn("row", inputProps.disabled ? null : "cursor-pointer", className)} htmlFor={id}>
			<span className="col">
				{label}
				{hint ? <span className="form-hint d-block">{hint}</span> : null}
			</span>
			<span className="col-auto">
				<span className="form-check form-check-single form-switch">
					<input {...inputProps} id={id} className="form-check-input" type="checkbox" />
				</span>
			</span>
		</label>
	);
}

export { SwitchField };
