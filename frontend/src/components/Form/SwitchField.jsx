import { Children } from "react";
import { controlAria } from "src/modules/FormFields";
import { FieldMessage } from "./FieldMessage";
import { SettingBadges } from "./SettingBadge";
import { SettingLine } from "./SettingLine";
import { useBadgesFit } from "./useBadgesFit";

// A native checkbox drawn as a switch with the tokens of the shadcn switch. Not Radix's Switch: that is a button, and
// the callers hand this field a register() result (ref, name, onChange with event.target.checked, onBlur), which
// needs a real checkbox.
const SWITCH_INPUT =
	"relative h-[18.4px] w-8 shrink-0 cursor-pointer appearance-none rounded-full border border-transparent bg-input outline-none transition-colors before:absolute before:top-1/2 before:left-0 before:size-4 before:-translate-y-1/2 before:rounded-full before:bg-background before:transition-transform before:content-[''] checked:bg-primary checked:before:translate-x-3.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/80 dark:before:bg-foreground dark:checked:bg-primary dark:checked:before:bg-primary-foreground";

// the width the text column has: the row without the switch and the gap before it
function textColumnWidth(row) {
	const control = row.querySelector("input");
	const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
	return row.getBoundingClientRect().width - (control?.getBoundingClientRect().width ?? 0) - gap;
}

/**
 * A settings row: text (and an optional hint) on the left, a switch on the right. The switch is described by its
 * error and its hint; the error shows under the row. Badges sit beside the label when they fit the text column, else
 * at the bottom of the text after the hint. A list of rows is a SwitchList. With line: one SettingLine with the switch
 * on the right, in a Settings card.
 */
function SwitchField({ id, label, hint, badges, error, className, line = false, ...inputProps }) {
	const hasBadges = Children.toArray(badges).length > 0;
	const aria = controlAria({
		id,
		hasHint: Boolean(hint),
		hasBadges,
		error,
		describedBy: inputProps["aria-describedby"],
	});
	const { inline, rowRef, labelRef, badgesRef } = useBadgesFit({
		enabled: hasBadges && !line,
		getRowWidth: textColumnWidth,
	});
	const input = (
		<input
			{...inputProps}
			id={id}
			className={SWITCH_INPUT}
			type="checkbox"
			// biome-ignore lint/a11y/useAriaPropsForRole: a checkbox input exposes its checked state itself
			role="switch"
			// named by the label text alone: the hint is not part of the name, it is the description
			aria-labelledby={aria.labelId}
			aria-invalid={aria["aria-invalid"]}
			aria-describedby={aria["aria-describedby"]}
		/>
	);
	if (line) {
		return (
			<SettingLine
				id={id}
				layout="switch"
				labelFor={id}
				titleId={aria.labelId}
				hintId={aria.hintId}
				errorId={aria.errorId}
				title={label}
				hint={hint}
				badges={hasBadges ? <SettingBadges id={aria.badgesId}>{badges}</SettingBadges> : null}
				error={error}
				control={input}
				className={className}
			/>
		);
	}
	const badgesRow = hasBadges ? (
		<SettingBadges id={aria.badgesId} ref={badgesRef}>
			{badges}
		</SettingBadges>
	) : null;
	const labelText = (
		<span className="font-medium" id={aria.labelId} ref={labelRef}>
			{label}
		</span>
	);
	return (
		<div className={className}>
			<label
				ref={rowRef}
				className="flex items-start justify-between gap-4 has-[:disabled]:opacity-50"
				htmlFor={id}
			>
				<span className="flex min-w-0 flex-col gap-0.5 text-sm leading-snug">
					{hasBadges ? (
						<span className="flex items-center gap-2">
							{labelText}
							{inline ? badgesRow : null}
						</span>
					) : (
						labelText
					)}
					{hint ? (
						<span className="text-muted-foreground" id={aria.hintId}>
							{hint}
						</span>
					) : null}
					{inline ? null : badgesRow}
				</span>
				{input}
			</label>
			{error ? (
				<FieldMessage id={aria.errorId} className="mt-1">
					{error}
				</FieldMessage>
			) : null}
		</div>
	);
}

export { SwitchField };
