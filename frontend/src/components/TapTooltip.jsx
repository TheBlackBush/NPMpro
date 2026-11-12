import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useRef, useState } from "react";
import { Tooltip, TooltipContent } from "src/components/ui/tooltip";
import { keyboardFocusOnly } from "src/modules/TooltipFocus";

// The Radix trigger itself, not the ui wrapper: that one sets data-slot="tooltip-trigger", which would replace the
// data-slot of the element it wraps (a Button's or a Badge's styles select on it)
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * A tooltip on a small label: hover or keyboard focus opens it, a tap toggles it (touch screens have no hover), a tap
 * elsewhere or Escape closes it. The label becomes focusable, and a click on it never reaches a switch's label. Focus
 * that is not keyboard focus (a window opened with the mouse focuses its first element) does not open it.
 *
 * @param {Object} props
 * @param {*} props.content  the tooltip's text
 * @param {boolean} [props.tap]  false: hover and keyboard focus only (the child keeps its own click and focus
 *                               behaviour); use it on a button, a link or anything inside one
 * @param {boolean} [props.hoverable]  false: the tooltip closes as soon as the pointer leaves the trigger, also on its
 *                                     way into the tooltip; for rows of small triggers, where the tooltip covers the
 *                                     row above and would otherwise keep it from its own tooltip
 * @param {import("react").ReactElement} props.children  one element that forwards its props and ref to the DOM
 */
export function TapTooltip({ content, tap = true, hoverable = true, children }) {
	const [open, setOpen] = useState(false);
	// whether the tooltip was open when the press started: a tap toggles it, and the press itself closes it first
	const wasOpen = useRef(false);
	if (!tap) {
		return (
			// a press closes it even when the child's own handler prevented the default (a menu trigger does), which
			// would otherwise leave the tooltip over the opened menu
			<Tooltip open={open} onOpenChange={setOpen} disableHoverableContent={!hoverable}>
				<TooltipTrigger asChild onFocus={keyboardFocusOnly} onPointerDown={() => setOpen(false)}>
					{children}
				</TooltipTrigger>
				<TooltipContent className="wrap-anywhere" data-tooltip-passthrough={hoverable ? undefined : ""}>
					{content}
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<Tooltip open={open} onOpenChange={setOpen} disableHoverableContent={!hoverable}>
			<TooltipTrigger
				asChild
				tabIndex={0}
				onFocus={keyboardFocusOnly}
				onPointerDown={() => {
					wasOpen.current = open;
				}}
				onClick={(event) => {
					event.preventDefault();
					setOpen(!wasOpen.current);
					wasOpen.current = !wasOpen.current;
				}}
			>
				{children}
			</TooltipTrigger>
			<TooltipContent className="wrap-anywhere" data-tooltip-passthrough={hoverable ? undefined : ""}>
				{content}
			</TooltipContent>
		</Tooltip>
	);
}
