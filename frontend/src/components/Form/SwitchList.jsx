import cn from "clsx";
import { switchListClass } from "src/modules/FormFields";

/**
 * Settings rows of switches (SwitchField), stacked without dividers: one column, or two columns from the md
 * breakpoint. Put it in a FormSection to name the group.
 *
 * @param {Object} props
 * @param {1|2}    [props.columns]
 * @param {string} [props.className]
 * @param {*}      props.children  SwitchField rows
 */
function SwitchList({ columns = 1, className, children }) {
	return <div className={cn(switchListClass(columns), className)}>{children}</div>;
}

export { SwitchList };
