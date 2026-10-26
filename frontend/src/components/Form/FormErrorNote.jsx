import cn from "clsx";
import { getIn, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { intl, T } from "src/locale";

const INVALID = '.is-invalid, [aria-invalid="true"], .invalid-feedback.d-block';
const FOCUSABLE = "input:not([type=hidden]), select, textarea, button";
const NO_LABELS = {};
const LIST_INDEX = /\[(?<index>\d+)\]/gu;
const PATH_START = /[.[]/u;

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
	// a list item's field may be named locations[0].path or locations.0.path
	const names = [...new Set([name, name.replaceAll(LIST_INDEX, ".$<index>")])];
	const control =
		names.map((n) => form.querySelector(`[name="${CSS.escape(n)}"]`)).find(Boolean) ??
		form.querySelector(`#${CSS.escape(name)}`);
	if (!control) return null;
	const own = control.getAttribute("aria-label");
	if (own) return own.trim();
	const byFor = control.id ? form.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null;
	if (byFor) return byFor.textContent?.trim() || null;
	// else the nearest form label above the control (custom selects keep their input in nested wrappers)
	for (let node = control.parentElement; node && node !== form; node = node.parentElement) {
		const label = node.querySelector(".form-label, legend");
		if (label) return label.textContent?.trim() || null;
	}
	return null;
};

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The path of every error message in Formik's errors: name, fieldValues.token, locations[0].path
 *
 * @param   {*}       errors
 * @param   {string}  [prefix]
 * @returns {string[]}
 */
const errorPaths = (errors, prefix = "") => {
	if (typeof errors === "string") return prefix ? [prefix] : [];
	if (Array.isArray(errors)) return errors.flatMap((item, index) => errorPaths(item, `${prefix}[${index}]`));
	if (errors && typeof errors === "object") {
		return Object.entries(errors).flatMap(([key, value]) => errorPaths(value, prefix ? `${prefix}.${key}` : key));
	}
	return [];
};

/**
 * The fields whose error the form shows. late: only after the field was left (touched) or a submit was tried, for
 * forms that start empty (an add form); else every error at once, for forms that start with saved values.
 *
 * @param   {boolean}  [late]
 * @returns {string[]} the paths of the fields (errorPaths)
 */
const useShownErrors = (late = false) => {
	const { errors, touched, submitCount } = useFormikContext();
	const paths = errorPaths(errors);
	return late && submitCount === 0 ? paths.filter((path) => Boolean(getIn(touched, path))) : paths;
};

/**
 * Place next to a form's submit button, inside its Formik form, and give the button
 * blocked={useShownErrors(late).length > 0} and aria-describedby={id}. While a shown field has an error it names the
 * fields to fix. After a submit Formik refused (Enter in a field) it also shows the first marked field.
 *
 * @param {Object}  props
 * @param {string}  props.id           referenced by the button's aria-describedby
 * @param {Object}  [props.labels]     field name -> translation id of its label, for a field whose label the form
 *                                     does not show next to a control of that name (keep the object stable)
 * @param {boolean} [props.late]       name a field only after it was left or a submit was tried (useShownErrors)
 * @param {string}  [props.messageId]  the note, with {fields}: "Fix before saving: {fields}" by default
 * @param {boolean} [props.block]      its own centred line (under full-width buttons), without height while empty
 * @param {string}  [props.className]
 */
function FormErrorNote({
	id,
	labels = NO_LABELS,
	late = false,
	messageId = "form.fix-fields",
	block = false,
	className,
}) {
	const { submitCount, isSubmitting, isValid } = useFormikContext();
	const ref = useRef(null);
	const handled = useRef(0);
	const [names, setNames] = useState([]);
	const keysId = useShownErrors(late).join("|");

	// the labels are read from the rendered form, so after the render
	useEffect(() => {
		const form = ref.current?.closest("form");
		const found = keysId
			.split("|")
			.filter(Boolean)
			.map((path) => {
				const labelId = labels[path] ?? labels[path.split(PATH_START)[0]];
				return (labelId ? intl.formatMessage({ id: labelId }) : labelInForm(form, path)) ?? path;
			});
		const unique = [...new Set(found)];
		setNames((current) => (sameList(current, unique) ? current : unique));
	}, [keysId, labels]);

	useEffect(() => {
		if (isSubmitting || isValid || submitCount === handled.current) return;
		handled.current = submitCount;
		showFirstInvalid(ref.current?.closest("form"));
	}, [submitCount, isSubmitting, isValid]);

	const show = keysId !== "" && names.length > 0;
	const Tag = block ? "div" : "span";
	return (
		<Tag
			ref={ref}
			id={id}
			className={cn("text-danger small", block && "text-center", block && show && "mt-2", className)}
			role="status"
		>
			{show ? <T id={messageId} data={{ fields: names.join(", ") }} /> : null}
		</Tag>
	);
}

export { FormErrorNote, showFirstInvalid, useShownErrors };
