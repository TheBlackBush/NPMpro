import { cn } from "src/lib/utils";

const LINK = "underline-offset-4 hover:text-foreground hover:underline";
const CREDITS = [
	{ href: "https://github.com/TheBlackBush", label: "NPMpro by TheBlackBush" },
	{ href: "https://github.com/ZoeyVid/NPMplus", label: "NPMplus by ZoeyVid" },
	{ href: "https://jc21.com", label: "jc21.com" },
];

/** The credits of the app footer and the signed-out pages (no data fetch: it shows before sign-in too) */
export function Credits({ className }) {
	return (
		<div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs", className)}>
			{CREDITS.map(({ href, label }) => (
				<a key={href} href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
					{label}
				</a>
			))}
		</div>
	);
}
