import cn from "clsx";

/**
 * A group of fields with its name, as Tabler's fieldset: the legend first; boxed: Tabler's form-fieldset (tinted,
 * bordered). A group of radios or switches is always a FormSection, so screen readers read the question.
 *
 * @param {Object}  props
 * @param {*}       props.legend
 * @param {boolean} [props.boxed]
 * @param {boolean} [props.hideLegend]  the legend only for screen readers
 * @param {string}  [props.className]   of the fieldset, "mb-3" when not boxed (form-fieldset has its own margin)
 * @param {*}       props.children
 */
function FormSection({ legend, boxed = false, hideLegend = false, className, children }) {
	return (
		<fieldset className={cn(boxed && "form-fieldset", className ?? (boxed ? null : "mb-3"))}>
			<legend className={cn("form-label", hideLegend && "visually-hidden")}>{legend}</legend>
			{children}
		</fieldset>
	);
}

export { FormSection };
