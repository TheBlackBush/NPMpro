import cn from "clsx";
import { controlAria } from "src/modules/FormFields";

/**
 * Tabler settings row: text (and an optional hint) on the left, a switch on the right
 * (https://preview.tabler.io/form-elements.html, "Notification" fieldset). The switch is described by its error and
 * its hint; the error shows under the row. A list of rows is a SwitchList.
 */
function SwitchField({ id, label, hint, error, className, ...inputProps }) {
	const aria = controlAria({ id, hasHint: Boolean(hint), error, describedBy: inputProps["aria-describedby"] });
	return (
		<div className={className}>
			<label className={cn("row", inputProps.disabled ? null : "cursor-pointer")} htmlFor={id}>
				<span className="col">
					{label}
					{hint ? (
						<span className="form-hint d-block" id={aria.hintId}>
							{hint}
						</span>
					) : null}
				</span>
				<span className="col-auto">
					<span className="form-check form-check-single form-switch">
						<input
							{...inputProps}
							id={id}
							className={cn("form-check-input", error && "is-invalid")}
							type="checkbox"
							aria-invalid={aria["aria-invalid"]}
							aria-describedby={aria["aria-describedby"]}
						/>
					</span>
				</span>
			</label>
			{error ? (
				<div className="invalid-feedback d-block" id={aria.errorId}>
					{error}
				</div>
			) : null}
		</div>
	);
}

export { SwitchField };
