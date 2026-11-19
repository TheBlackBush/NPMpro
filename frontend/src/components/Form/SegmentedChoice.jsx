import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { RadioGroup } from "src/components/ui/radio-group";
import { cn } from "src/lib/utils";
import { segmentedClass } from "src/modules/FormFields";

/**
 * A few exclusive choices as one segmented control: a Radix radio group whose radios are the segments. Tab reaches
 * the group, the arrow keys move between the enabled segments.
 *
 * @param {Object}   props
 * @param {string}   props.name
 * @param {string}   props.labelledBy  the id of the visible name of the group
 * @param {Array<{ value: string, label: *, disabled?: boolean }>} props.options
 * @param {string}   props.value
 * @param {Function} props.onChange    (value) => void
 * @param {Function} [props.onBlur]    once when the focus leaves the group
 * @param {Function|Object} [props.inputRef]  the checked segment (else the first), for the focus of an error
 * @param {boolean}  [props.full]
 * @param {string}   [props.className]
 */
function SegmentedChoice({ name, labelledBy, options, value, onChange, onBlur, inputRef, full = true, className }) {
	const classes = segmentedClass({ full });
	const focusIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);
	return (
		<RadioGroup
			aria-labelledby={labelledBy}
			name={name}
			orientation="horizontal"
			value={value ?? ""}
			onValueChange={onChange}
			className={cn(classes.group, className)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.(event);
			}}
		>
			{options.map((option, index) => (
				<RadioGroupPrimitive.Item
					key={option.value}
					value={option.value}
					disabled={Boolean(option.disabled)}
					ref={index === focusIndex ? inputRef : undefined}
					className={classes.item}
				>
					{option.label}
				</RadioGroupPrimitive.Item>
			))}
		</RadioGroup>
	);
}

export { SegmentedChoice };
