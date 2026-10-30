import cn from "clsx";
import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-hook-form";
import { intl, T } from "src/locale";
import { errorPaths, orderErrorPaths } from "src/modules/HookForm";
import { useFieldOrder } from "./HookForm";

const NO_LABELS = {};
const LIST_INDEX = /\[(?<index>\d+)\]/gu;
const PATH_START = /[.[]/u;

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
 * The note naming the fields to fix: their labels, read from the rendered form after the render
 *
 * @param {Object}   props
 * @param {string[]} props.paths       the fields with a shown error, in form order
 * @param {Object}   props.labels
 * @param {string}   props.messageId
 * @param {boolean}  props.block
 * @param {string}   [props.id]
 * @param {string}   [props.className]
 * @param {Object}   props.noteRef
 */
function ErrorNoteText({ id, paths, labels, messageId, block, className, noteRef }) {
	const [names, setNames] = useState([]);
	const keysId = paths.join("|");

	useEffect(() => {
		const form = noteRef.current?.closest("form");
		const found = keysId
			.split("|")
			.filter(Boolean)
			.map((path) => {
				const labelId = labels[path] ?? labels[path.split(PATH_START)[0]];
				return (labelId ? intl.formatMessage({ id: labelId }) : labelInForm(form, path)) ?? path;
			});
		const unique = [...new Set(found)];
		setNames((current) => (sameList(current, unique) ? current : unique));
	}, [keysId, labels, noteRef]);

	const show = keysId !== "" && names.length > 0;
	const Tag = block ? "div" : "span";
	return (
		<Tag
			ref={noteRef}
			id={id}
			className={cn("text-danger small", block && "text-center", block && show && "mt-2", className)}
			role="status"
		>
			{show ? <T id={messageId} data={{ fields: names.join(", ") }} /> : null}
		</Tag>
	);
}

/**
 * Place next to a form's submit button, inside its HookForm, and give the button blocked={the form holds an error}
 * and aria-describedby={id}. While a field shows an error (React Hook Form's errors: once left, or after a save was
 * tried) it names the fields to fix, in form order; HookForm focuses the first one after a refused save.
 *
 * @param {Object}  props
 * @param {string}  props.id           referenced by the button's aria-describedby
 * @param {Object}  [props.labels]     field name -> translation id of its label, for a field whose label the form
 *                                     does not show next to a control of that name (keep the object stable)
 * @param {string}  [props.messageId]  the note, with {fields}: "Fix before saving: {fields}" by default
 * @param {boolean} [props.block]      its own centred line (under full-width buttons), without height while empty
 * @param {string}  [props.className]
 */
function FormErrorNote({ labels = NO_LABELS, messageId = "form.fix-fields", block = false, ...props }) {
	const { errors } = useFormState();
	const order = useFieldOrder();
	const ref = useRef(null);
	return (
		<ErrorNoteText
			{...props}
			labels={labels}
			messageId={messageId}
			block={block}
			paths={orderErrorPaths(errorPaths(errors), order)}
			noteRef={ref}
		/>
	);
}

export { FormErrorNote };
