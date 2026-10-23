import { NavLink, useParams } from "react-router";
import { ErrorNotFound } from "src/components";
import { T } from "src/locale";
import { SECTIONS } from "./sections";

export default function Layout() {
	const { section } = useParams();
	const current = SECTIONS.find((s) => s.id === section);

	if (!current) {
		return <ErrorNotFound />;
	}

	const Section = current.element;

	return (
		<div className="card">
			<div className="card-status-top bg-teal" />
			<div className="row g-0">
				<div className="col-12 col-md-3 border-end">
					<div className="card-body">
						<nav className="list-group list-group-transparent" aria-label="Settings">
							{SECTIONS.map(({ id, labelKey, icon: Icon }) => (
								<NavLink
									key={id}
									to={`/settings/${id}`}
									className="list-group-item list-group-item-action d-flex align-items-center"
								>
									<Icon className="icon me-2" aria-hidden="true" />
									<T id={labelKey} />
								</NavLink>
							))}
						</nav>
					</div>
				</div>
				<div className="col-12 col-md-9 d-flex flex-column">
					<Section />
				</div>
			</div>
		</div>
	);
}
