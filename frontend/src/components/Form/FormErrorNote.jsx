import cn from "clsx";
import { useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { intl, T } from "src/locale";

const INVALID = '.is-invalid, [aria-invalid="true"], .invalid-feedback.d-block';
const FOCUSABLE = "input:not([type=hidden]), select, textarea, button";
const NO_LABELS = {};

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
 * The visible label of a field, found in the form: the label of the control named like the field (or with it as id),
 * else the form label of the block around it
 */
const labelInForm = (form, name) => {
	if (!form) return null;
	const escaped = CSS.escape(name);
	const control = form.querySelector(`[name="${escaped}"]`) ?? form.querySelector(`#${escaped}`);
	if (!control) return null;
	const byFor = control.id ? form.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
	const label = byFor ?? control.closest(".mb-3, fieldset")?.querySelector(".form-label, legend");
	return label?.textContent?.trim() || null;
};

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Place next to a form's submit button, inside its Formik form, and give the button blocked={!isValid} and
 * aria-describedby={id}. While a field has an error it names the fields to fix. After a submit Formik refused (Enter
 * in a field) it also shows the first marked field.
 *
 * @param {Object}  props
 * @param {string}  props.id          referenced by the button's aria-describedby
 * @param {Object}  [props.labels]    field name -> translation id of its label, for a field whose label the form does
 *                                    not show next to a control of that name (keep the object stable)
 * @param {boolean} [props.block]     its own centred line (under full-width buttons), without height while empty
 * @param {string}  [props.className]
 */
function FormErrorNote({ id, labels = NO_LABELS, block = false, className }) {
	const { submitCount, isSubmitting, isValid, errors } = useFormikContext();
	const ref = useRef(null);
	const handled = useRef(0);
	const [names, setNames] = useState([]);
	const keysId = Object.keys(errors ?? {}).join("|");

	// the labels are read from the rendered form, so after the render
	useEffect(() => {
		const form = ref.current?.closest("form");
		const found = keysId
			.split("|")
			.filter(Boolean)
			.map((key) => (labels[key] ? intl.formatMessage({ id: labels[key] }) : labelInForm(form, key)) ?? key);
		const unique = [...new Set(found)];
		setNames((current) => (sameList(current, unique) ? current : unique));
	}, [keysId, labels]);

	useEffect(() => {
		if (isSubmitting || isValid || submitCount === handled.current) return;
		handled.current = submitCount;
		showFirstInvalid(ref.current?.closest("form"));
	}, [submitCount, isSubmitting, isValid]);

	const show = !isValid && names.length > 0;
	const Tag = block ? "div" : "span";
	return (
		<Tag
			ref={ref}
			id={id}
			className={cn("text-danger small", block && "text-center", block && show && "mt-2", className)}
			role="status"
		>
			{show ? <T id="form.fix-fields" data={{ fields: names.join(", ") }} /> : null}
		</Tag>
	);
}

export { FormErrorNote };
