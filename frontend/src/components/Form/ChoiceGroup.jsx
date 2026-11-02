import { cn } from "cn";
import { useId } from "react";
import { useController } from "react-hook-form";
import { choiceGroupClass, choiceItemClass, controlAria, joinIds } from "src/modules/FormFields";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "src/ui/field";
import { RadioGroup, RadioGroupItem } from "src/ui/radio-group";
import { FieldMessage } from "./FieldMessage";

/**
 * A small set of exclusive choices: shadcn's RadioGroup in a FieldSet whose legend names the question, each option a
 * choice card (Tab reaches the group, the arrow keys move between its options and choose), the error and the hint
 * under it.
 *
 * @param {Object}   props
 * @param {string}   props.name                the radios' name, one group per name in the page
 * @param {*}        props.legend
 * @param {boolean}  [props.hideLegend]        the legend only for screen readers
 * @param {Array<{ value: string, label: *, description?: *, disabled?: boolean, describedBy?: string }>} props.options
 * @param {string}   props.value
 * @param {Function} props.onChange            (value) => void
 * @param {Function} [props.onBlur]            once when focus leaves the group
 * @param {Function|Object} [props.inputRef]  the radio of the checked option (else the first), for the focus
 * @param {"buttons"|"pills"|"boxes"} [props.variant]  boxes show each option's description
 * @param {boolean}  [props.fill]              the options share the row
 * @param {boolean}  [props.vertical]          one option per line
 * @param {*}        [props.hint]
 * @param {string|null} [props.error]
 * @param {boolean}  [props.disabled]
 * @param {string}   [props.className]         of the fieldset, a 1rem bottom margin by default
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
	className = "tw:mb-4",
}) {
	const baseId = useId();
	const aria = controlAria({ id: baseId, hasHint: Boolean(hint), error });
	const legendId = `${baseId}-legend`;
	const focusIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);
	return (
		<FieldSet
			className={cn("tw:gap-2", className)}
			data-invalid={error ? true : undefined}
			// one blur when focus leaves the group, not for each arrow key move between its options
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.(event);
			}}
		>
			<FieldLegend id={legendId} variant="label" className={cn("tw:mb-0", hideLegend && "tw:sr-only")}>
				{legend}
			</FieldLegend>
			<RadioGroup
				name={name}
				value={value}
				onValueChange={onChange}
				disabled={disabled}
				aria-labelledby={legendId}
				className={choiceGroupClass({ variant, fill, vertical })}
			>
				{options.map((option, index) => {
					const optionDisabled = disabled || Boolean(option.disabled);
					const itemId = `${baseId}-${index}`;
					return (
						<FieldLabel
							key={option.value}
							htmlFor={itemId}
							className={choiceItemClass({ fill: fill || vertical, disabled: optionDisabled })}
						>
							<Field orientation="horizontal" data-disabled={optionDisabled ? true : undefined}>
								<RadioGroupItem
									ref={index === focusIndex ? inputRef : undefined}
									id={itemId}
									value={option.value}
									disabled={optionDisabled}
									aria-invalid={aria["aria-invalid"]}
									aria-describedby={joinIds(aria["aria-describedby"], option.describedBy)}
								/>
								<FieldContent>
									<FieldTitle>{option.label}</FieldTitle>
									{variant === "boxes" && option.description ? (
										<FieldDescription>{option.description}</FieldDescription>
									) : null}
								</FieldContent>
							</Field>
						</FieldLabel>
					);
				})}
			</RadioGroup>
			{error ? <FieldMessage id={aria.errorId}>{error}</FieldMessage> : null}
			{hint ? <FieldDescription id={aria.hintId}>{hint}</FieldDescription> : null}
		</FieldSet>
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
