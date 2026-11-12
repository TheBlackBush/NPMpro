import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";
import { isCut } from "src/modules/Overflow";

/**
 * One line of text, cut with an ellipsis when it does not fit. Only while it is cut it gets a tooltip with the whole
 * text: hover, keyboard focus and a tap, or with tap={false} hover and focus only (inside a link or a button, which
 * keep their own click).
 *
 * The width is measured after every render (new text) and on every size change of the element (ResizeObserver). The
 * element is mounted again when it gains or loses the tooltip, and the callback ref observes the new one.
 *
 * @param {Object} props
 * @param {import("react").ReactNode} props.children  the text
 * @param {import("react").ReactNode} [props.content]  the tooltip's text, when it differs from the children
 * @param {boolean} [props.tap]  false inside a link or a button
 * @param {boolean} [props.hoverable]  false in a row of small entries (see TapTooltip)
 * @param {string} [props.className]  font and colour of the line
 */
function TruncatedText({ children, content, tap = true, hoverable = true, className }) {
	const element = useRef(null);
	const [cut, setCut] = useState(false);
	const observe = useCallback((node) => {
		element.current = node;
		if (!node || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => setCut(isCut(node)));
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	// no dependencies on purpose: new text can change the width without a size change of the box
	useLayoutEffect(() => {
		setCut(isCut(element.current));
	});
	const text = (
		<span ref={observe} className={cn("block min-w-0 truncate", className)}>
			{children}
		</span>
	);
	return cut ? (
		<TapTooltip content={content ?? children} tap={tap} hoverable={hoverable}>
			{text}
		</TapTooltip>
	) : (
		text
	);
}

export { TruncatedText };
