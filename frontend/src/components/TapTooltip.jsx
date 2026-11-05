import { useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";

/**
 * A tooltip on a small label: hover or keyboard focus opens it, a tap toggles it (touch screens have no hover), a tap
 * elsewhere or Escape closes it. The label becomes focusable, and a click on it never reaches a switch's label.
 *
 * @param {Object} props
 * @param {*} props.content  the tooltip's text
 * @param {boolean} [props.tap]  false: hover and keyboard focus only (the child keeps its own click and focus
 *                               behaviour); use it on a button, a link or anything inside one
 * @param {import("react").ReactElement} props.children  one element that forwards its props and ref to the DOM
 */
export function TapTooltip({ content, tap = true, children }) {
	const [open, setOpen] = useState(false);
	// whether the tooltip was open when the press started: a tap toggles it, and the press itself closes it first
	const wasOpen = useRef(false);
	if (!tap) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent className="wrap-anywhere">{content}</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger
				asChild
				tabIndex={0}
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
			<TooltipContent className="wrap-anywhere">{content}</TooltipContent>
		</Tooltip>
	);
}
