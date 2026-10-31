import cn from "clsx";
import { useId } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { Button } from "src/components/Button";
import { T } from "src/locale";
import { errorPaths } from "src/modules/HookForm";
import { sectionColor } from "src/modules/SectionColors";
import { FormErrorNote } from "./FormErrorNote";
import { focusFirstError, useFieldOrder, useFormTabs } from "./HookForm";

/**
 * A form's submit button with the reason next to it whenever it cannot be used: while a field shows an error it
 * looks disabled (aria-disabled, still reachable) and a red note names the fields; with nothing to save it is
 * disabled and a grey note says so. An error shows once its field was left or a save was tried (mode onTouched);
 * "nothing to save" is !isDirty.
 *
 * @param {Object}   props
 * @param {*}        props.children        the button text
 * @param {boolean}  [props.edit]          an edit form: without changes there is nothing to save (disabled, reason)
 * @param {boolean}  [props.disabled]      not available for another reason (submitting, a test running)
 * @param {Object}   [props.labels]        field name -> label translation id for the note (a stable object)
 * @param {string}   [props.messageId]     the note's text (FormErrorNote)
 * @param {string}   [props.className]     of the wrapper, e.g. "ms-auto" in a modal footer
 * @param {boolean}  [props.stacked]       a full-width button with the note centred under it (login, setup)
 * @param {string}   [props.section]       the section of the window (SectionColors.js): the button takes its colour,
 *                                         primary without one; color overrides it (a destructive action: danger)
 * @param {Object}   props.buttonProps     the rest goes to Button (color, isLoading, ...)
 */
function FormSubmit({
	children,
	edit = false,
	disabled = false,
	labels,
	messageId,
	className,
	stacked = false,
	section,
	color,
	...buttonProps
}) {
	const { setFocus } = useFormContext();
	const { isSubmitting, isDirty, errors } = useFormState();
	const order = useFieldOrder();
	const tabs = useFormTabs();
	const blocked = errorPaths(errors).length > 0;
	const unchanged = edit && !isDirty;
	const noteId = useId();
	const reasonId = useId();
	const showReason = unchanged && !blocked && !isSubmitting;
	const button = (
		<Button
			{...buttonProps}
			color={color ?? sectionColor(section)}
			type="submit"
			fullWidth={stacked || buttonProps.fullWidth}
			disabled={disabled || (unchanged && !blocked)}
			blocked={blocked}
			onBlockedClick={() => focusFirstError(errors, order, setFocus, tabs?.current)}
			// keeps the focus in the field until the click is done: a blur error appearing first would move the
			// button away from under the pointer and the click would be lost
			onMouseDown={(e) => e.preventDefault()}
			aria-describedby={blocked ? noteId : showReason ? reasonId : undefined}
		>
			{children}
		</Button>
	);
	if (stacked) {
		return (
			<div className={className}>
				{button}
				<FormErrorNote id={noteId} labels={labels} messageId={messageId} block />
			</div>
		);
	}
	// takes the room left next to the other footer buttons without asking for more (a zero flex basis, which no
	// Bootstrap utility sets), so a long note wraps inside it instead of pushing the footer onto two lines
	return (
		<div
			className={cn("d-flex align-items-center justify-content-end", className)}
			style={{ flex: "1 1 0", minWidth: 0 }}
		>
			<FormErrorNote id={noteId} labels={labels} messageId={messageId} className="me-3 text-end" />
			{showReason ? (
				<span id={reasonId} className="text-secondary small me-3 text-end">
					<T id="form.no-changes" />
				</span>
			) : null}
			{button}
		</div>
	);
}

export { FormSubmit };
