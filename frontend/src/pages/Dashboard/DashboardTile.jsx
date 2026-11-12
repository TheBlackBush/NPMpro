import { Link } from "react-router";
import { Card } from "src/components/ui/card";
import { cn } from "src/lib/utils";
import { CARD_LINK, CARD_POP } from "src/modules/CardLink";
import { sectionAccent } from "src/modules/SectionAccents";

/**
 * Dashboard count tile: a card that links to the page it counts, with the icon in a square tinted by the section accent
 * of the host type (the same accents as the list pages); without a section the square is neutral.
 *
 * Icon and text start at the top, and the text block is at least as high as the icon with its text centred: one line
 * sits in the middle of the icon, a wrapped label grows downwards and its icon stays level with the row's other icons.
 *
 * @param {object} props
 * @param {string} props.to
 * @param {import("react").ElementType} props.icon
 * @param {string} [props.section]                         a key of SECTIONS (SectionAccents.js) (proxyHosts, streams, ...)
 * @param {import("react").ReactNode} props.children
 */
function DashboardTile({ to, icon: Icon, section, children }) {
	const accent = section ? sectionAccent(section) : null;
	return (
		<Link to={to} className={CARD_LINK}>
			<Card className={CARD_POP}>
				<div className="flex min-w-0 items-start gap-3 px-(--card-spacing)">
					<span
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-md",
							accent ? cn(accent.bg, accent.text) : "bg-muted text-foreground",
						)}
					>
						<Icon className="size-5" aria-hidden="true" />
					</span>
					<div className="flex min-h-10 min-w-0 flex-1 flex-col justify-center font-medium">{children}</div>
				</div>
			</Card>
		</Link>
	);
}

export { DashboardTile };
