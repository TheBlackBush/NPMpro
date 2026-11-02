import cn from "clsx";
import { useId } from "react";
import { useController } from "react-hook-form";
import { Field, FieldDescription, FieldLabel } from "src/components/ui/field";
import { RadioGroup, RadioGroupItem } from "src/components/ui/radio-group";
import { choiceGroupClass, choiceItemClass, controlAria, joinIds, legendClass } from "src/modules/FormFields";
import { FieldMessage } from "./FieldMessage";

/**
 * A small set of exclusive choices as a radio group of cards: a fieldset whose legend names the question, one radio
 * per option (Tab reaches the group, the arrow keys move between its options), the error and the hint under it.
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
 * @param {"buttons"|"pills"|"boxes"} [props.variant]  boxes show each option's description, pills are round
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
	const legendId = `${baseId}-legend`;
	const aria = controlAria({ id: baseId, hasHint: Boolean(hint), error });
	const focusIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);
	return (
		<fieldset
			className={cn("flex min-w-0 flex-col gap-2", className)}
			// one blur when focus leaves the group, not for each arrow key move between its options
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.(event);
			}}
		>
			<legend className={legendClass({ hideLegend })} id={legendId}>
				{legend}
			</legend>
			<RadioGroup
				aria-labelledby={legendId}
				className={choiceGroupClass({ variant, fill, vertical })}
				disabled={disabled}
				name={name}
				onValueChange={onChange}
				value={value ?? ""}
			>
				{options.map((option, index) => {
					const optionDisabled = disabled || Boolean(option.disabled);
					const itemId = `${baseId}-${index}`;
					return (
						<FieldLabel
							key={option.value}
							className={choiceItemClass({ variant, fill: fill || vertical })}
							htmlFor={itemId}
						>
							<Field data-disabled={optionDisabled ? true : undefined} orientation="horizontal">
								<RadioGroupItem
									aria-describedby={joinIds(aria["aria-describedby"], option.describedBy)}
									aria-invalid={aria["aria-invalid"]}
									disabled={optionDisabled}
									id={itemId}
									ref={index === focusIndex ? inputRef : undefined}
									value={option.value}
								/>
								<span className="flex min-w-0 flex-col gap-0.5 text-left text-sm leading-snug">
									<span className="font-medium">{option.label}</span>
									{variant === "boxes" && option.description ? (
										<span className="font-normal text-muted-foreground">{option.description}</span>
									) : null}
								</span>
							</Field>
						</FieldLabel>
					);
				})}
			</RadioGroup>
			{error ? <FieldMessage id={aria.errorId}>{error}</FieldMessage> : null}
			{hint ? <FieldDescription id={aria.hintId}>{hint}</FieldDescription> : null}
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
