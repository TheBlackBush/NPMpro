import { Link } from "react-router";
import { cn } from "src/lib/utils";

const FILE = { mark: "logo-mark", horizontal: "logo-horizontal" };
// the horizontal artwork carries a small word mark, so it needs more height than the square mark to stay readable
const HEIGHT = { mark: "h-8", horizontal: "h-10" };

/**
 * The NPMpro logo as a link to the dashboard; both theme files are in the page and the `dark` class picks one.
 *
 * @param {Object} props
 * @param {"mark"|"horizontal"} [props.variant]
 * @param {string} [props.className]  extra classes for both images
 * @param {string} [props.alt]        text alternative; empty where the name is written next to the logo
 */
export function Logo({ variant = "horizontal", className, alt = "NPMpro" }) {
	const file = FILE[variant];
	return (
		<Link to="/" className="inline-flex shrink-0 items-center rounded-md">
			<img
				src={`/images/${file}-light.svg`}
				className={cn(HEIGHT[variant], "w-auto dark:hidden", className)}
				alt={alt}
			/>
			<img
				src={`/images/${file}-dark.svg`}
				className={cn("hidden", HEIGHT[variant], "w-auto dark:block", className)}
				alt={alt}
			/>
		</Link>
	);
}
