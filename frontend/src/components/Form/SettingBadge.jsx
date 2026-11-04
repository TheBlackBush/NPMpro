import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";

/**
 * A badge of a setting's badge row (set by an env var, restart required, when a change applies): an outline chip
 * with an icon. It shrinks to the row and its text wraps (a long variable name breaks anywhere), so it never pushes
 * the label or leaves the card.
 *
 * @param {Object} props
 * @param {import("react").ComponentType} props.icon  a lucide icon
 * @param {string} [props.className]
 */
function SettingBadge({ icon: Icon, className, children }) {
	return (
		<Badge
			variant="outline"
			className={cn(
				"h-auto min-w-0 max-w-full shrink whitespace-normal py-0.5 text-left wrap-anywhere",
				className,
			)}
		>
			<Icon aria-hidden="true" />
			<span className="min-w-0">{children}</span>
		</Badge>
	);
}

/**
 * The wrapping row of a field's badges, directly under its label; its id describes the control
 *
 * @param {Object} props
 * @param {string} props.id
 */
function SettingBadges({ id, children }) {
	return (
		<div id={id} data-slot="field-badges" className="flex min-w-0 flex-wrap items-center gap-1.5">
			{children}
		</div>
	);
}

export { SettingBadge, SettingBadges };
