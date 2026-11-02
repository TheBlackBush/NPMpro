import { cn } from "cn";

/**
 * A field's error message: shadcn's FieldError look (its data-slot, so the field's styles apply) without its live
 * region (role="alert"), as before: the message shows when the field is left, and the control is described by it
 *
 * @param {Object} props
 * @param {string} props.id
 * @param {string} [props.className]
 * @param {*}      props.children
 */
function FieldMessage({ id, className, children }) {
	return (
		<div id={id} data-slot="field-error" className={cn("tw:text-sm tw:font-normal tw:text-destructive", className)}>
			{children}
		</div>
	);
}

export { FieldMessage };
