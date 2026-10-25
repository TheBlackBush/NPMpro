import { Link } from "react-router";

/**
 * Dashboard count tile: Tabler small card with a square avatar icon (https://docs.tabler.io/ui/components/card.md)
 */
function DashboardTile({ to, icon: Icon, color, children }) {
	return (
		<div className="col-sm-6 col-lg-3">
			<Link to={to} className="card card-sm card-link card-link-pop">
				<div className="card-body">
					<div className="row align-items-center">
						<div className="col-auto">
							<span className={`avatar avatar-square text-bg-${color}`}>
								<Icon className="icon" aria-hidden="true" />
							</span>
						</div>
						<div className="col fw-medium">{children}</div>
					</div>
				</div>
			</Link>
		</div>
	);
}

export { DashboardTile };
