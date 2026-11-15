import { Info } from "lucide-react";
import { TapTooltip } from "../TapTooltip";

/**
 * The info icon of a setting line, beside its title: the text shows as a tooltip (on tap on touch screens)
 *
 * @param {Object} props
 * @param {*}      props.content
 * @param {string} props.labelledBy  the id of the line's title, which names the button
 */
function InfoBadge({ content, labelledBy }) {
	return (
		<TapTooltip content={content}>
			<button
				type="button"
				aria-labelledby={labelledBy}
				className="inline-flex shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
			>
				<Info aria-hidden="true" className="size-3.5" />
			</button>
		</TapTooltip>
	);
}

export { InfoBadge };
