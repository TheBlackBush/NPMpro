import { useRef, useState } from "react";
import { Badge } from "src/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
import { cn } from "src/lib/utils";

/**
 * A badge of a setting's badge row (set by an env var, restart required, when a change applies): an outline chip
 * with an icon. It shrinks to the row and its text wraps (a long variable name breaks anywhere), so it never pushes
 * the label or leaves the card.
 *
 * With a `description` the chip is focusable and explains itself in a tooltip: hover or keyboard focus opens it, a
 * tap toggles it (a tap elsewhere or Escape closes it), and screen readers get the sentence after the short text
 * (so the control's aria-describedby carries it). A click never reaches a switch's label. Without one it is a plain
 * chip.
 *
 * @param {Object} props
 * @param {import("react").ComponentType} props.icon  a lucide icon
 * @param {*} [props.description]  the full sentence behind a short text
 * @param {string} [props.className]
 * @param {import("react").Ref<HTMLSpanElement>} [props.ref]
 */
function SettingBadge({ icon: Icon, description, className, children, ...props }) {
	const [open, setOpen] = useState(false);
	// whether the tooltip was open when the press started: a tap toggles it, and the press itself closes it first
	const wasOpen = useRef(false);
	const chip = (extra) => (
		<Badge
			variant="outline"
			className={cn(
				"h-auto min-w-0 max-w-full shrink whitespace-normal py-0.5 text-left wrap-anywhere",
				className,
			)}
			{...props}
			{...extra}
		>
			<Icon aria-hidden="true" />
			<span className="min-w-0">
				{children}
				{description ? <span className="sr-only"> ({description})</span> : null}
			</span>
		</Badge>
	);
	if (!description) return chip();
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				{chip({
					tabIndex: 0,
					onPointerDown: () => {
						wasOpen.current = open;
					},
					onClick: (event) => {
						// inside a switch's label a click would toggle the switch
						event.preventDefault();
						setOpen(!wasOpen.current);
						wasOpen.current = !wasOpen.current;
					},
				})}
			</TooltipTrigger>
			<TooltipContent>{description}</TooltipContent>
		</Tooltip>
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
