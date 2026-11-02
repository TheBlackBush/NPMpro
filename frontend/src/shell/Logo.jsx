import { Link } from "react-router";
import { cn } from "src/lib/utils";

const FILE = { mark: "logo-mark", horizontal: "logo-horizontal" };

/**
 * The NPMpro logo as a link to the dashboard; both theme files are in the page and the `dark` class picks one.
 *
 * @param {Object} props
 * @param {"mark"|"horizontal"} [props.variant]
 * @param {string} [props.className]  extra classes for both images
 */
export function Logo({ variant = "horizontal", className }) {
	const file = FILE[variant];
	return (
		<Link to="/" className="inline-flex shrink-0 items-center rounded-md">
			<img src={`/images/${file}-light.svg`} className={cn("h-8 w-auto dark:hidden", className)} alt="NPMpro" />
			<img
				src={`/images/${file}-dark.svg`}
				className={cn("hidden h-8 w-auto dark:block", className)}
				alt="NPMpro"
			/>
		</Link>
	);
}
