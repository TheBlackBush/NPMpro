/**
 * The top of a signed-in page: its title as the page's one h1, an optional description, and the page's main actions on
 * the right ("Add Proxy Host", import and export, help), which wrap under the title on a narrow screen. A new part
 * (data-slot: Tailwind's reset applies) inside the old page; the actions are still the old pages' buttons, so they sit
 * in an old part again (data-legacy-ui) and keep Tabler's look.
 *
 * @param {Object} props
 * @param {*}      props.title
 * @param {*}      [props.description]
 * @param {*}      [props.actions]
 */
function PageHeader({ title, description, actions }) {
	return (
		<div
			data-slot="page-header"
			className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-3 tw:text-foreground"
		>
			{/* the title keeps its line; the actions wrap under it on a narrow screen */}
			<div className="tw:min-w-fit tw:flex-1">
				<h1 className="tw:text-2xl tw:leading-tight tw:font-semibold tw:tracking-tight">{title}</h1>
				{description ? <p className="tw:mt-1 tw:text-sm tw:text-muted-foreground">{description}</p> : null}
			</div>
			{actions ? (
				<div data-legacy-ui="" className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:print:hidden">
					{actions}
				</div>
			) : null}
		</div>
	);
}

export { PageHeader };
