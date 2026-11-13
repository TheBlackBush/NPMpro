import { cn } from "src/lib/utils";

const COMMAND = /(<!--#.*?-->)/u;

/**
 * A text with its `<!--# ... -->` commands in a monospace span, so the closing "-->" does not turn into an arrow in
 * the sans font.
 *
 * @param {Object} props
 * @param {string} props.children
 * @param {string} [props.className]  of each code span
 */
function CodeText({ children, className }) {
	if (typeof children !== "string") return children;
	return children.split(COMMAND).map((part, index) =>
		index % 2 === 1 ? (
			// the parts are in a fixed order, the index is their identity
			<code key={index} className={cn("font-mono text-[0.9em] [font-variant-ligatures:none]", className)}>
				{part}
			</code>
		) : (
			part
		),
	);
}

export { CodeText };
