import { cn } from "cn";
import { FieldLegend, FieldSet } from "src/ui/field";

/**
 * A group of fields with its name: shadcn's FieldSet and FieldLegend, the legend first; boxed: a tinted, bordered
 * box. A group of radios or switches is always a FormSection, so screen readers read the question. The children are
 * the window's own markup (fields of this layer, Tabler rows, pickers): they sit in an old part again
 * (data-legacy-ui), so Tailwind's reset stops at them; the fields of this layer are new parts of their own.
 *
 * @param {Object}  props
 * @param {*}       props.legend
 * @param {boolean} [props.boxed]
 * @param {boolean} [props.hideLegend]  the legend only for screen readers
 * @param {boolean} [props.heading]     the legend as a section heading with a thin line under it, for sections of
 *                                      switches whose names would blend in
 * @param {string}  [props.className]   of the fieldset, a 1rem bottom margin by default
 * @param {*}       props.children
 */
function FormSection({ legend, boxed = false, hideLegend = false, heading = false, className, children }) {
	return (
		<FieldSet
			className={cn("tw:gap-2", boxed && "tw:rounded-lg tw:border tw:bg-muted/50 tw:p-4", className ?? "tw:mb-4")}
		>
			<FieldLegend
				variant={heading ? "legend" : "label"}
				className={cn(heading && "tw:mb-2 tw:w-full tw:border-b tw:pb-2", hideLegend && "tw:sr-only")}
			>
				{legend}
			</FieldLegend>
			<div data-legacy-ui="">{children}</div>
		</FieldSet>
	);
}

export { FormSection };
