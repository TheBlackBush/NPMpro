import { cn } from "src/lib/utils";
import { T } from "src/locale";

// whole links at least 24 px tall (WCAG 2.5.8) without changing the text size
const LINK = "inline-flex min-h-6 items-center underline-offset-4 hover:text-foreground hover:underline";
// project and author names are proper names: only the joining word is translated; the projects this one is based
// on are credited by their author's name alone
const CREDITS = [
	{ href: "https://github.com/TheBlackBush", project: "NPMpro", author: "TheBlackBush" },
	{ href: "https://github.com/ZoeyVid/NPMplus", author: "ZoeyVid" },
	{ href: "https://github.com/NginxProxyManager/nginx-proxy-manager", author: "jc21" },
];

/** The credits of the app footer and the signed-out pages (no data fetch: it shows before sign-in too) */
export function Credits({ className }) {
	return (
		<div className={cn("flex flex-wrap items-center gap-x-4 text-muted-foreground text-xs", className)}>
			{CREDITS.map(({ href, project, author }) => (
				<a key={href} href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
					{project ? <T id="footer.credit" data={{ project, author }} /> : author}
				</a>
			))}
		</div>
	);
}
