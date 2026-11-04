import { Link } from "react-router";
import { Card } from "src/components/ui/card";
import { cn } from "src/lib/utils";
import { sectionAccent } from "src/modules/SectionAccents";

/**
 * Dashboard count tile: a card that links to the page it counts, with the icon in a square tinted by the section accent
 * of the host type (the same accents as the list pages); without a section the square is neutral.
 *
 * @param {object} props
 * @param {string} props.to                                route to link to
 * @param {import("react").ElementType} props.icon        lucide icon
 * @param {string} [props.section]                         a key of SECTIONS (SectionAccents.js) (proxyHosts, streams, ...)
 * @param {import("react").ReactNode} props.children       the count text or highlights
 */
function DashboardTile({ to, icon: Icon, section, children }) {
	const accent = section ? sectionAccent(section) : null;
	return (
		<Link
			to={to}
			className="block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			<Card className="h-full transition-colors hover:bg-muted/50">
				<div className="flex min-w-0 items-center gap-3 px-(--card-spacing)">
					<span
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-md",
							accent ? cn(accent.bg, accent.text) : "bg-muted text-foreground",
						)}
					>
						<Icon className="size-5" aria-hidden="true" />
					</span>
					<div className="min-w-0 flex-1 font-medium">{children}</div>
				</div>
			</Card>
		</Link>
	);
}

export { DashboardTile };
