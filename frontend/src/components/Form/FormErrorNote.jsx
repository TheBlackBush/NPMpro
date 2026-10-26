import cn from "clsx";
import { useFormikContext } from "formik";
import { useEffect, useRef } from "react";
import { T } from "src/locale";

const INVALID = '.is-invalid, [aria-invalid="true"], .invalid-feedback.d-block';
const FOCUSABLE = "input:not([type=hidden]), select, textarea, button";

/**
 * Shows the first marked field of a form: opens its tab, scrolls to it and focuses it (the field itself, or for a
 * message without a marked field the first control next to it)
 */
const showFirstInvalid = (form) => {
	const marked = form?.querySelector(INVALID);
	if (!marked) return;
	const pane = marked.closest(".tab-pane:not(.active)");
	if (pane) form.querySelector(`[data-bs-toggle="tab"][href="#${pane.id}"]`)?.click();
	const target = marked.matches(FOCUSABLE) ? marked : marked.parentElement?.querySelector(FOCUSABLE);
	marked.scrollIntoView({ block: "center" });
	target?.focus({ preventScroll: true });
};

/**
 * Place next to a form's submit button, inside its Formik form. Formik does not submit while a field has an error;
 * after such a submit this shows why and takes the user to the first marked field. The note stays until the form is
 * valid. block: its own centred line (under full-width buttons), without height while hidden.
 */
function FormErrorNote({ className, block = false }) {
	const { submitCount, isSubmitting, isValid } = useFormikContext();
	const ref = useRef(null);
	const handled = useRef(0);

	useEffect(() => {
		if (isSubmitting || isValid || submitCount === handled.current) return;
		handled.current = submitCount;
		showFirstInvalid(ref.current?.closest("form"));
	}, [submitCount, isSubmitting, isValid]);

	const show = submitCount > 0 && !isValid;
	const Tag = block ? "div" : "span";
	return (
		<Tag
			ref={ref}
			className={cn("text-danger", block && "text-center", block && show && "mt-2", className)}
			role="status"
		>
			{show ? <T id="form.fix-marked-fields" /> : null}
		</Tag>
	);
}

export { FormErrorNote };
