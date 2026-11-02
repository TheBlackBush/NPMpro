import { cn } from "cn";
import { useId } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { T } from "src/locale";
import { errorPaths } from "src/modules/HookForm";
import { Button } from "src/ui/button";
import { Spinner } from "src/ui/spinner";
import { FormErrorNote } from "./FormErrorNote";
import { focusFirstError, useFieldOrder, useFormTabs } from "./HookForm";

// the colours of the old buttons that mean a destructive action (MFA off): shadcn's destructive variant
const DESTRUCTIVE = new Set(["danger", "red"]);

/**
 * A form's submit button (shadcn's Button, as tall as the old footer buttons) with the reason next to it whenever it
 * cannot be used: while a field shows an error it looks disabled (aria-disabled, still reachable) and a red note names
 * the fields; a click then focuses the first error. With nothing to save it is disabled and a grey note says so. An
 * error shows once its field was left or a save was tried (mode onTouched); "nothing to save" is !isDirty. While it
 * saves (isLoading) a spinner stands before the label.
 *
 * @param {Object}   props
 * @param {*}        props.children        the button text
 * @param {boolean}  [props.edit]          an edit form: without changes there is nothing to save (disabled, reason)
 * @param {boolean}  [props.disabled]      not available for another reason (submitting, a test running)
 * @param {Object}   [props.labels]        field name -> label translation id for the note (a stable object)
 * @param {string}   [props.messageId]     the note's text (FormErrorNote)
 * @param {string}   [props.className]     of the wrapper, e.g. "ms-auto" in a modal footer
 * @param {boolean}  [props.stacked]       a full-width button with the note centred under it (login, setup)
 * @param {string}   [props.section]       the window's section; kept for the callers, the button is the primary colour
 * @param {string}   [props.color]         "danger" (or "red"): a destructive action, shadcn's destructive variant
 * @param {boolean}  [props.isLoading]     saving: the spinner, aria-busy
 * @param {boolean}  [props.fullWidth]
 * @param {Object}   props.buttonProps     the rest goes to the button
 */
function FormSubmit({
	children,
	edit = false,
	disabled = false,
	labels,
	messageId,
	className,
	stacked = false,
	section: _section,
	color,
	isLoading = false,
	fullWidth = false,
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
			type="submit"
			size="lg"
			variant={DESTRUCTIVE.has(color) ? "destructive" : "default"}
			disabled={disabled || (unchanged && !blocked)}
			// blocked: the disabled look, but still focusable and clickable (to show what to fix)
			aria-disabled={blocked || undefined}
			aria-busy={isLoading || undefined}
			className={cn(
				"tw:px-3",
				(stacked || fullWidth) && "tw:w-full",
				blocked && "tw:cursor-not-allowed tw:opacity-50",
			)}
			onClick={(event) => {
				if (!blocked) return;
				// also stops the form submit (keyboard activation too)
				event.preventDefault();
				focusFirstError(errors, order, setFocus, tabs?.current);
			}}
			// keeps the focus in the field until the click is done: a blur error appearing first would move the
			// button away from under the pointer and the click would be lost
			onMouseDown={(event) => event.preventDefault()}
			aria-describedby={blocked ? noteId : showReason ? reasonId : undefined}
		>
			{isLoading ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
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
	// takes the room left next to the other footer buttons without asking for more (a zero flex basis), so a long
	// note wraps inside it instead of pushing the footer onto two lines
	return (
		<div className={cn("tw:flex tw:min-w-0 tw:flex-[1_1_0] tw:items-center tw:justify-end tw:gap-3", className)}>
			<FormErrorNote id={noteId} labels={labels} messageId={messageId} className="tw:text-end" />
			{showReason ? (
				<span id={reasonId} className="tw:text-end tw:text-sm tw:text-muted-foreground">
					<T id="form.no-changes" />
				</span>
			) : null}
			{button}
		</div>
	);
}

export { FormSubmit };
