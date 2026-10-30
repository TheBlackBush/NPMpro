import cn from "clsx";
import { Children } from "react";
import { switchListClass } from "src/modules/FormFields";

/**
 * Tabler settings rows of switches (SwitchField): one column divided by lines, or two columns from the md
 * breakpoint. Put it in a FormSection to name the group.
 *
 * @param {Object} props
 * @param {1|2}    [props.columns]
 * @param {string} [props.className]
 * @param {*}      props.children  SwitchField rows (empty ones are skipped)
 */
function SwitchList({ columns = 1, className, children }) {
	if (columns !== 2) return <div className={cn(switchListClass(1), className)}>{children}</div>;
	return (
		<div className={cn(switchListClass(2), className)}>
			{Children.toArray(children).map((child) => (
				<div key={child.key} className="col py-2">
					{child}
				</div>
			))}
		</div>
	);
}

export { SwitchList };
