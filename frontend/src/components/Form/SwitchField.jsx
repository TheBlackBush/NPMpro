import cn from "clsx";
import { FieldError } from "src/components/ui/field";
import { controlAria } from "src/modules/FormFields";

// A native checkbox drawn as a switch with the tokens of ui/switch.jsx. Not Radix's Switch: that is a button, and the
// callers hand this field a register() result (ref, name, onChange with event.target.checked, onBlur), which needs
// a real checkbox.
const SWITCH_INPUT =
	"relative h-[18.4px] w-8 shrink-0 cursor-pointer appearance-none rounded-full border border-transparent bg-input outline-none transition-colors before:absolute before:top-1/2 before:left-0 before:size-4 before:-translate-y-1/2 before:rounded-full before:bg-background before:transition-transform before:content-[''] checked:bg-primary checked:before:translate-x-3.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/80 dark:before:bg-foreground dark:checked:before:bg-primary-foreground";

/**
 * A settings row: text (and an optional hint) on the left, a switch on the right. The switch is described by its
 * error and its hint; the error shows under the row. A list of rows is a SwitchList.
 */
function SwitchField({ id, label, hint, error, className, ...inputProps }) {
	const aria = controlAria({ id, hasHint: Boolean(hint), error, describedBy: inputProps["aria-describedby"] });
	return (
		<div className={className}>
			<label
				className={cn("flex items-start justify-between gap-4", inputProps.disabled && "opacity-50")}
				htmlFor={id}
			>
				<span className="flex min-w-0 flex-col gap-0.5 text-sm leading-snug">
					<span className="font-medium" id={aria.labelId}>
						{label}
					</span>
					{hint ? (
						<span className="text-muted-foreground" id={aria.hintId}>
							{hint}
						</span>
					) : null}
				</span>
				<input
					{...inputProps}
					id={id}
					className={SWITCH_INPUT}
					type="checkbox"
					// biome-ignore lint/a11y/useAriaPropsForRole: a checkbox input exposes its checked state itself
					role="switch"
					// named by the label text alone: the hint sits inside the label element, so it would be read
					// twice, in the name and as the description
					aria-labelledby={aria.labelId}
					aria-invalid={aria["aria-invalid"]}
					aria-describedby={aria["aria-describedby"]}
				/>
			</label>
			{error ? (
				<FieldError id={aria.errorId} className="mt-1">
					{error}
				</FieldError>
			) : null}
		</div>
	);
}

export { SwitchField };
