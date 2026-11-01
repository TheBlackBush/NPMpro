import cn from "clsx";

/**
 * A group of fields with its name, as Tabler's fieldset: the legend first; boxed: Tabler's form-fieldset (tinted,
 * bordered). A group of radios or switches is always a FormSection, so screen readers read the question.
 *
 * @param {Object}  props
 * @param {*}       props.legend
 * @param {boolean} [props.boxed]
 * @param {boolean} [props.hideLegend]  the legend only for screen readers
 * @param {boolean} [props.heading]     the legend as a heading, spaced like the Options heading of the host
 *                                      windows (h3 fw-medium py-2): for sections of switches whose names would blend in
 * @param {string}  [props.className]   of the fieldset, "mb-3" when not boxed (form-fieldset has its own margin)
 * @param {*}       props.children
 */
function FormSection({ legend, boxed = false, hideLegend = false, heading = false, className, children }) {
	return (
		<fieldset className={cn(boxed && "form-fieldset", className ?? (boxed ? null : "mb-3"))}>
			<legend className={cn(heading ? "h3 fw-medium py-2" : "form-label", hideLegend && "visually-hidden")}>
				{legend}
			</legend>
			{children}
		</fieldset>
	);
}

export { FormSection };
