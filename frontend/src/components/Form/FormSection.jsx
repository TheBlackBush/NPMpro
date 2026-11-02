import cn from "clsx";
import { legendClass, sectionClass } from "src/modules/FormFields";

/**
 * A group of fields with its name: a fieldset with the legend first; boxed: a tinted, bordered panel. A group of
 * radios or switches is always a FormSection, so screen readers read the question.
 *
 * @param {Object}  props
 * @param {*}       props.legend
 * @param {boolean} [props.boxed]
 * @param {boolean} [props.hideLegend]  the legend only for screen readers
 * @param {boolean} [props.heading]     the legend in the group heading style (text-base font-medium): for sections
 *                                      of switches whose names would blend in
 * @param {string}  [props.className]   of the fieldset, "mb-3" when not boxed
 * @param {*}       props.children
 */
function FormSection({ legend, boxed = false, hideLegend = false, heading = false, className, children }) {
	return (
		<fieldset className={cn(sectionClass({ boxed }), className ?? (boxed ? null : "mb-3"))}>
			<legend className={legendClass({ heading, hideLegend })}>{legend}</legend>
			{children}
		</fieldset>
	);
}

export { FormSection };
