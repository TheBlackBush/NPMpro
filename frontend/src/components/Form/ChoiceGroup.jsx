import { useId } from "react";
import { useController } from "react-hook-form";
import { choiceGroupClass, choiceItemClass, controlAria, joinIds } from "src/modules/FormFields";

/**
 * A small set of exclusive choices as Tabler's select group: a fieldset whose legend names the question, one radio
 * per option (Tab reaches the group, the arrow keys move between its options), the error and the hint under it.
 *
 * @param {Object}   props
 * @param {string}   props.name                the radios' name, one group per name in the page
 * @param {*}        props.legend
 * @param {boolean}  [props.hideLegend]        the legend only for screen readers
 * @param {Array<{ value: string, label: *, description?: *, disabled?: boolean, describedBy?: string }>} props.options
 * @param {string}   props.value
 * @param {Function} props.onChange            (value) => void
 * @param {Function} [props.onBlur]
 * @param {Function|Object} [props.inputRef]  the input of the checked option (else the first), for the focus
 * @param {"buttons"|"pills"|"boxes"} [props.variant]  boxes show each option's description
 * @param {boolean}  [props.fill]              the options share the row
 * @param {boolean}  [props.vertical]          one option per line
 * @param {*}        [props.hint]
 * @param {string|null} [props.error]
 * @param {boolean}  [props.disabled]
 * @param {string}   [props.className]         of the fieldset, "mb-3" by default
 */
function ChoiceGroup({
	name,
	legend,
	hideLegend = false,
	options,
	value,
	onChange,
	onBlur,
	inputRef,
	variant = "buttons",
	fill = false,
	vertical = false,
	hint,
	error = null,
	disabled = false,
	className = "mb-3",
}) {
	const baseId = useId();
	const aria = controlAria({ id: baseId, hasHint: Boolean(hint), error });
	const focusIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);
	return (
		<fieldset className={className}>
			<legend className={hideLegend ? "visually-hidden" : "form-label"}>{legend}</legend>
			<div className={choiceGroupClass({ variant, fill, vertical })}>
				{options.map((option, index) => {
					const optionDisabled = disabled || Boolean(option.disabled);
					return (
						<label
							key={option.value}
							className={choiceItemClass({ fill: fill || vertical, disabled: optionDisabled })}
						>
							<input
								ref={index === focusIndex ? inputRef : undefined}
								type="radio"
								className="form-selectgroup-input"
								name={name}
								value={option.value}
								checked={value === option.value}
								disabled={optionDisabled}
								onChange={() => onChange(option.value)}
								onBlur={onBlur}
								aria-invalid={aria["aria-invalid"]}
								aria-describedby={joinIds(aria["aria-describedby"], option.describedBy)}
							/>
							{variant === "boxes" ? (
								<span className="form-selectgroup-label d-flex align-items-center p-3 text-start">
									<span className="me-3">
										<span className="form-selectgroup-check" />
									</span>
									<span>
										<span className="d-block fw-medium">{option.label}</span>
										{option.description ? (
											<span className="d-block text-secondary small">{option.description}</span>
										) : null}
									</span>
								</span>
							) : (
								<span className="form-selectgroup-label">{option.label}</span>
							)}
						</label>
					);
				})}
			</div>
			{error ? (
				<div className="invalid-feedback d-block" id={aria.errorId}>
					{error}
				</div>
			) : null}
			{hint ? (
				<div className="form-hint" id={aria.hintId}>
					{hint}
				</div>
			) : null}
		</fieldset>
	);
}

/**
 * A ChoiceGroup for a field of the form around it (a controller); onChange(value) runs after the field took it
 */
function ChoiceField({ name, onChange, ...props }) {
	const { field, fieldState } = useController({ name });
	return (
		<ChoiceGroup
			{...props}
			name={field.name}
			value={field.value}
			inputRef={field.ref}
			onBlur={field.onBlur}
			error={fieldState.error?.message ?? null}
			onChange={(value) => {
				field.onChange(value);
				onChange?.(value);
			}}
		/>
	);
}

export { ChoiceField, ChoiceGroup };
