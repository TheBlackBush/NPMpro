import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { ErrorNotFound } from "src/components";
import { confirmLeave } from "src/hooks";
import { intl, T } from "src/locale";
import { selectedSectionId } from "src/modules/SettingsMenu";
import { SECTIONS } from "./sections";

export default function Layout() {
	const { section } = useParams();
	const { pathname } = useLocation();
	const navigate = useNavigate();
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
						<div className="d-md-none">
							<label className="visually-hidden" htmlFor="settings-section">
								<T id="settings" />
							</label>
							{/* controlled by the route: a refused leave leaves the value on the current section */}
							<select
								id="settings-section"
								className="form-select"
								value={selectedSectionId(
									pathname,
									SECTIONS.map((s) => s.id),
								)}
								onChange={(e) => {
									if (confirmLeave()) void navigate(`/settings/${e.target.value}`);
								}}
							>
								{SECTIONS.map(({ id, labelKey }) => (
									<option key={id} value={id}>
										{intl.formatMessage({ id: labelKey })}
									</option>
								))}
							</select>
						</div>
						<nav
							className="d-none d-md-block list-group list-group-transparent"
							aria-label={intl.formatMessage({ id: "settings" })}
						>
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
