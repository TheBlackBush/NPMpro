import cn from "clsx";
import { Fragment } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ErrorNotFound } from "src/components";
import { confirmLeave } from "src/hooks";
import { intl, T } from "src/locale";
import { stripeClass } from "src/modules/SectionColors";
import { groupSections } from "src/modules/SettingsSections";
import { SettingsSectionContext } from "./SettingsHeading";
import { SECTIONS } from "./sections";

// the menu's categories, each with its sections (fixed, so grouped once)
const CATEGORIES = groupSections(SECTIONS);

export default function Layout() {
	const { section } = useParams();
	const navigate = useNavigate();
	const current = SECTIONS.find((s) => s.id === section);

	if (!current) {
		return <ErrorNotFound />;
	}

	const Section = current.element;

	return (
		<div className="card">
			<div className={stripeClass("settings")} />
			<div className="row g-0">
				<div className="col-12 d-lg-none">
					<div className="card-body">
						<div>
							<label className="visually-hidden" htmlFor="settings-section">
								<T id="settings.section" />
							</label>
							{/* controlled by the route: a refused leave leaves the value on the current section */}
							<select
								id="settings-section"
								className="form-select"
								value={current.id}
								onChange={(e) => {
									if (confirmLeave()) void navigate(`/settings/${e.target.value}`);
								}}
							>
								{CATEGORIES.map((category) => (
									<optgroup key={category.id} label={intl.formatMessage({ id: category.labelKey })}>
										{category.sections.map(({ id, labelKey }) => (
											<option key={id} value={id}>
												{intl.formatMessage({ id: labelKey })}
											</option>
										))}
									</optgroup>
								))}
							</select>
						</div>
					</div>
				</div>
				<div className="d-none d-lg-block col-lg-3 border-end">
					{/* Tabler's settings menu: a subheader per category, each with its own list (nav) named by it */}
					<div className="card-body">
						{CATEGORIES.map((category, index) => (
							<Fragment key={category.id}>
								<h2
									className={cn("subheader", index > 0 && "mt-4")}
									id={`settings-category-${category.id}`}
								>
									<T id={category.labelKey} />
								</h2>
								<nav
									className="list-group list-group-transparent"
									aria-labelledby={`settings-category-${category.id}`}
								>
									{category.sections.map(({ id, labelKey, icon: Icon }) => (
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
							</Fragment>
						))}
					</div>
				</div>
				<div className="col-12 col-lg-9 d-flex flex-column">
					<SettingsSectionContext.Provider value={current.id}>
						<Section />
					</SettingsSectionContext.Provider>
				</div>
			</div>
		</div>
	);
}
