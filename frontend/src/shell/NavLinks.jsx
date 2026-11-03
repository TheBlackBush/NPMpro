import { ExternalLink } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { navAccent } from "src/modules/SectionAccents";
import { useNavItems } from "./useNavItems";

const ROW =
	"relative inline-flex h-9 whitespace-nowrap items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground";
const ROW_ACTIVE = "text-foreground after:absolute after:inset-x-3 after:-bottom-1.5 after:h-0.5 after:rounded-full";
const COLUMN = "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted";
const COLUMN_ACTIVE = "text-foreground";

/** Whether a nav item is the current page: "/" matches exactly, the others by prefix; external items never */
export function isActivePath(pathname, { to, external }) {
	return !external && (to === "/" ? pathname === "/" : pathname.startsWith(to));
}

/**
 * The main links as a nav landmark.
 *
 * @param {Object}   props
 * @param {"row"|"column"} [props.orientation]  row (icons and labels) for the top bar's menu row, column for the phone menu
 * @param {Function} [props.onNavigate]         called when a link is followed (closes the phone menu)
 */
export function NavLinks({ orientation = "row", onNavigate }) {
	const items = useNavItems();
	const { pathname } = useLocation();
	const column = orientation === "column";

	return (
		<nav aria-label={intl.formatMessage({ id: "aria.main-navigation" })}>
			<ul className={cn("flex gap-1", column ? "flex-col" : "flex-row items-center")}>
				{items.map((item) => {
					const { id, to, label, Icon, external } = item;
					const active = isActivePath(pathname, item);
					const accent = navAccent(id);
					const className = cn(
						column ? COLUMN : ROW,
						active && (column ? COLUMN_ACTIVE : ROW_ACTIVE),
						// the underline of the top bar in the page's accent (the brand gradient without one)
						active && !column && accent.underline,
						// the phone menu row: tinted in the page's accent, the icon in the accent colour
						active && column && cn(accent.bg, "hover:bg-muted"),
					);
					return (
						<li key={id}>
							{external ? (
								<a href={to} target="_blank" rel="noopener" className={className} onClick={onNavigate}>
									<Icon className="size-4" aria-hidden="true" />
									{label}
									<ExternalLink className="size-3.5" aria-hidden="true" />
								</a>
							) : (
								<NavLink
									to={to}
									end={to === "/"}
									className={className}
									aria-current={active ? "page" : undefined}
									onClick={onNavigate}
								>
									<Icon
										className={cn("size-4", active && column && accent.text)}
										aria-hidden="true"
									/>
									{label}
								</NavLink>
							)}
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
