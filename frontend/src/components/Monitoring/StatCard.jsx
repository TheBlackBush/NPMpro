import { Link } from "react-router";

/**
 * Stat card: Tabler card with a subheader, a big value and an optional hint line
 * (https://docs.tabler.io/ui/components/card.md). With `to` the whole card links there.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.label     subheader text
 * @param {import("react").ReactNode} props.value     the big value
 * @param {import("react").ReactNode} [props.hint]    small line under the value
 * @param {import("react").ElementType} [props.icon]  Tabler icon shown next to the subheader
 * @param {string} [props.color]                      Tabler colour name for the icon, default "secondary"
 * @param {import("react").ReactNode} [props.children]          extra content under the hint (e.g. a sparkline)
 * @param {string} [props.to]                         route to link to
 * @param {string} [props.className]                  classes for the column wrapper
 */
function StatCard({
	label,
	value,
	hint,
	icon: Icon,
	color = "secondary",
	to,
	children,
	className = "col-sm-6 col-lg-3",
}) {
	const body = (
		<div className="card-body">
			<div className="d-flex align-items-center">
				<div className="subheader">{label}</div>
				{Icon ? (
					<div className="ms-auto lh-1">
						<Icon className={`icon text-${color}`} aria-hidden="true" />
					</div>
				) : null}
			</div>
			<div className="h1 mt-2 mb-0 text-truncate">{value}</div>
			{hint ? <div className="text-secondary small mt-1 text-truncate">{hint}</div> : null}
			{children}
		</div>
	);
	return (
		<div className={className}>
			{to ? (
				<Link to={to} className="card card-link card-link-pop">
					{body}
				</Link>
			) : (
				<div className="card">{body}</div>
			)}
		</div>
	);
}

export { StatCard };
