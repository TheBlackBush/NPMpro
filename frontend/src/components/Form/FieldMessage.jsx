import { cn } from "src/lib/utils";

/**
 * The visible error text of a field. Not announced on its own (no alert role): the control points at it with
 * aria-describedby and the form's error note announces the fields to fix.
 */
function FieldMessage({ className, ...props }) {
	return <div data-slot="field-error" className={cn("font-normal text-destructive text-sm", className)} {...props} />;
}

export { FieldMessage };
