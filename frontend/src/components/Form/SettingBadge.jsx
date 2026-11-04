import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";

/**
 * A badge of a setting's badge row (set by an env var, restart required, when a change applies): an outline chip
 * with an icon. It shrinks to the row and its text wraps (a long variable name breaks anywhere), so it never pushes
 * the label or leaves the card.
 *
 * @param {Object} props
 * @param {import("react").ComponentType} props.icon  a lucide icon
 * @param {*} [props.description]  the full sentence behind a short text: the chip's tooltip (title, when it is a string)
 *   and screen reader text after the short text
 * @param {string} [props.className]
 */
function SettingBadge({ icon: Icon, description, className, children }) {
	return (
		<Badge
			variant="outline"
			title={typeof description === "string" ? description : undefined}
			className={cn(
				"h-auto min-w-0 max-w-full shrink whitespace-normal py-0.5 text-left wrap-anywhere",
				className,
			)}
		>
			<Icon aria-hidden="true" />
			<span className="min-w-0">
				{children}
				{description ? <span className="sr-only"> ({description})</span> : null}
			</span>
		</Badge>
	);
}

/**
 * A field's badges in a wrapping row of their own width (so the width is the same beside the label and at the
 * bottom of the setting); its id describes the control. Placement is the form layer's (useBadgesFit).
 *
 * @param {Object} props
 * @param {string} props.id
 * @param {import("react").Ref<HTMLDivElement>} [props.ref]  for measuring
 */
function SettingBadges({ id, ref, children }) {
	return (
		<div
			id={id}
			ref={ref}
			data-slot="field-badges"
			className="inline-flex w-fit min-w-0 max-w-full flex-wrap items-center gap-1.5"
		>
			{children}
		</div>
	);
}

export { SettingBadge, SettingBadges };
