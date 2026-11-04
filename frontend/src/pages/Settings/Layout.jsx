import { Fragment, useMemo } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ErrorNotFound } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import { confirmLeave } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { groupSections } from "src/modules/SettingsSections";
import { SettingsSectionContext } from "./SettingsHeading";
import { SECTIONS } from "./sections";

// the menu's categories, each with its sections (fixed, so grouped once)
const CATEGORIES = groupSections(SECTIONS);

const LINK =
	"flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50";
const LINK_ACTIVE = "bg-muted font-medium text-foreground";

export default function Layout() {
	const { section } = useParams();
	const navigate = useNavigate();
	const current = SECTIONS.find((s) => s.id === section);
	// the phone picker's groups, one per category (the labels follow the language)
	const groups = useMemo(
		() =>
			CATEGORIES.map((category) => ({
				key: category.id,
				label: intl.formatMessage({ id: category.labelKey }),
				options: category.sections.map(({ id, labelKey }) => ({
					value: id,
					label: intl.formatMessage({ id: labelKey }),
				})),
			})),
		[],
	);

	if (!current) {
		return <ErrorNotFound level={2} />;
	}

	const Section = current.element;

	return (
		<div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
			<div className="lg:hidden">
				<label className="sr-only" htmlFor="settings-section">
					<T id="settings.section" />
				</label>
				{/* controlled by the route: a refused leave leaves the value on the current section */}
				<AppSelect
					id="settings-section"
					value={current.id}
					options={groups}
					onValueChange={(id) => {
						if (confirmLeave()) void navigate(`/settings/${id}`);
					}}
				/>
			</div>
			<nav aria-label={intl.formatMessage({ id: "settings" })} className="hidden lg:block">
				{CATEGORIES.map((category, index) => (
					<Fragment key={category.id}>
						<h2
							className={cn(
								"px-3 pb-1 text-xs font-medium text-muted-foreground uppercase",
								index > 0 && "mt-4",
							)}
						>
							<T id={category.labelKey} />
						</h2>
						<ul className="flex flex-col gap-0.5">
							{category.sections.map(({ id, labelKey, icon: Icon }) => (
								<li key={id}>
									<NavLink
										to={`/settings/${id}`}
										className={({ isActive }) => cn(LINK, isActive && LINK_ACTIVE)}
									>
										<Icon className="size-4 shrink-0" aria-hidden="true" />
										<T id={labelKey} />
									</NavLink>
								</li>
							))}
						</ul>
					</Fragment>
				))}
			</nav>
			<div className="flex min-w-0 flex-col">
				<SettingsSectionContext.Provider value={current.id}>
					<Section />
				</SettingsSectionContext.Provider>
			</div>
		</div>
	);
}
