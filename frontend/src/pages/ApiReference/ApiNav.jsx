import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { MethodBadge } from "./MethodBadge";

const START_HREF = "#getting-started";

const LINK =
	"flex items-center gap-2 rounded-md px-2 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";
const CURRENT = "bg-primary/10 text-primary";

/**
 * The left list: Getting started, then one link per group with its routes below the group of the current route
 *
 * @param {Object} props
 * @param {{ groups: Array<{ name: string, operations: object[] }> }} props.reference  the filtered reference
 * @param {string | null} props.active   id of the current section or article
 * @param {string} props.query           the search text (every group is open while it is set)
 * @param {boolean} props.showStart      the Getting started link
 * @param {() => void} [props.onNavigate]  runs after a link is chosen (closes the phone sheet)
 */
export function ApiNav({ reference, active, query, showStart, onNavigate }) {
	return (
		<nav aria-label={intl.formatMessage({ id: "api-reference.nav" })} className="flex flex-col gap-1 p-3">
			{showStart ? (
				<>
					<p className="m-0 px-2 pt-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						<T id="api-reference.start" />
					</p>
					<a
						href={START_HREF}
						onClick={onNavigate}
						aria-current={active === "getting-started" ? "location" : undefined}
						className={cn(LINK, active === "getting-started" && CURRENT)}
					>
						<T id="api-reference.getting-started" />
					</a>
				</>
			) : null}
			<p className="m-0 px-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				<T id="api-reference.groups" />
			</p>
			{reference.groups.length === 0 ? (
				<p className="m-0 px-2 py-1 text-muted-foreground text-sm">
					<T id="api-reference.search-empty" data={{ query }} />
				</p>
			) : null}
			{reference.groups.map((group) => {
				const current = active === group.name || group.operations.some((op) => op.anchor === active);
				return (
					<div key={group.name}>
						<a
							href={`#${group.name}`}
							onClick={onNavigate}
							aria-current={active === group.name ? "location" : undefined}
							className={cn(LINK, "font-mono", active === group.name && CURRENT)}
						>
							<span className="min-w-0 flex-1 truncate">{group.name}</span>
							<span className="text-muted-foreground text-xs">{group.operations.length}</span>
						</a>
						{current || query.trim() !== "" ? (
							<ul className="m-0 list-none ps-3 pb-1">
								{group.operations.map((op) => (
									<li key={op.anchor}>
										<a
											href={`#${op.anchor}`}
											onClick={onNavigate}
											aria-current={active === op.anchor ? "location" : undefined}
											className={cn(LINK, active === op.anchor && CURRENT)}
										>
											<MethodBadge method={op.method} className="w-10 shrink-0" />
											<span className="min-w-0 flex-1 truncate">{op.summary}</span>
										</a>
									</li>
								))}
							</ul>
						) : null}
					</div>
				);
			})}
		</nav>
	);
}
