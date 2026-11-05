import { cn } from "src/lib/utils";
import { T } from "src/locale";

// whole links at least 24 px tall (WCAG 2.5.8) without changing the text size
const LINK = "inline-flex min-h-6 items-center underline-offset-4 hover:text-foreground hover:underline";
// project and author names are proper names: only the joining word is translated
const CREDITS = [
	{ href: "https://github.com/TheBlackBush", project: "NPMpro", author: "TheBlackBush" },
	{ href: "https://github.com/ZoeyVid/NPMplus", project: "NPMplus", author: "ZoeyVid" },
];

/** The credits of the app footer and the signed-out pages (no data fetch: it shows before sign-in too) */
export function Credits({ className }) {
	return (
		<div className={cn("flex flex-wrap items-center gap-x-4 text-muted-foreground text-xs", className)}>
			{CREDITS.map(({ href, project, author }) => (
				<a key={href} href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
					<T id="footer.credit" data={{ project, author }} />
				</a>
			))}
			<a href="https://jc21.com" target="_blank" rel="noopener noreferrer" className={LINK}>
				jc21.com
			</a>
		</div>
	);
}
