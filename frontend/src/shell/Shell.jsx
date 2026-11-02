import { Fragment, useState } from "react";
import { Link } from "react-router";
import { intl } from "src/locale";
import { breadcrumbs, helpDocOf, sidebarOpenFromCookie } from "src/modules/Navigation";
import { Avatar, AvatarFallback, AvatarImage } from "src/ui/avatar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "src/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "src/ui/dropdown-menu";
import { Separator } from "src/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "src/ui/sidebar";
import { TooltipProvider } from "src/ui/tooltip";
import { AppSidebar, LogoMark } from "./AppSidebar";
import { PhoneExtraItems, UserItems, UserLabel } from "./menus";
import { PhoneNav } from "./PhoneNav";
import { useNavigation } from "./useNavigation";

const text = (id, values) => intl.formatMessage({ id }, values);

// the panel's width with the rail (sidebar-09 sets the whole width); a group without a panel shows the rail only
const WIDTH_WITH_PANEL = "18.5rem";
const WIDTH_RAIL_ONLY = "calc(var(--sidebar-width-icon) + 1px)";

/** The phone's avatar menu: the user, the page's help, theme and language, the profile actions */
function PhoneUserMenu({ user, helpDoc }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={text("aria.user-menu")}
				className="tw:ms-auto tw:rounded-lg tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
			>
				<Avatar className="tw:size-8 tw:rounded-lg">
					<AvatarImage src={user?.avatar || "/images/default-avatar.jpg"} alt="" />
					<AvatarFallback className="tw:rounded-lg">{user?.name?.charAt(0)}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="tw:w-auto tw:min-w-56">
				<UserLabel user={user} />
				<DropdownMenuSeparator />
				<PhoneExtraItems helpDoc={helpDoc} />
				<UserItems />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The header above the page: the button that folds the panel (when a panel shows) and the breadcrumbs; on a phone the
 * page's title and the avatar menu
 */
function ShellHeader({ trail, user, helpDoc, canFold }) {
	const { isMobile } = useSidebar();
	if (isMobile) {
		const title = trail.at(-1);
		return (
			<header className="tw:sticky tw:top-0 tw:z-20 tw:flex tw:h-12 tw:shrink-0 tw:items-center tw:gap-2 tw:border-b tw:bg-background tw:px-3 tw:text-foreground tw:print:hidden">
				<Link to="/" aria-label="NPMpro" className="tw:shrink-0">
					<LogoMark className="tw:size-7" />
				</Link>
				<p className="tw:min-w-0 tw:truncate tw:text-base tw:font-medium">
					{title ? text(title.titleKey) : "NPMpro"}
				</p>
				<PhoneUserMenu user={user} helpDoc={helpDoc} />
			</header>
		);
	}
	return (
		<header className="tw:sticky tw:top-0 tw:z-20 tw:flex tw:h-12 tw:shrink-0 tw:items-center tw:gap-2 tw:border-b tw:bg-background tw:px-4 tw:text-foreground tw:print:hidden">
			{canFold && (
				<>
					<SidebarTrigger className="tw:-ml-1" aria-label={text("aria.toggle-navigation")} />
					<Separator
						orientation="vertical"
						className="tw:mr-2 tw:data-vertical:h-4 tw:data-vertical:self-auto"
					/>
				</>
			)}
			<Breadcrumb aria-label={text("nav.breadcrumb")}>
				<BreadcrumbList>
					{trail.map((crumb, index) => (
						<Fragment key={crumb.titleKey}>
							{index > 0 && <BreadcrumbSeparator />}
							<BreadcrumbItem>
								{index === trail.length - 1 ? (
									<BreadcrumbPage>{text(crumb.titleKey)}</BreadcrumbPage>
								) : crumb.to ? (
									<BreadcrumbLink asChild>
										<Link to={crumb.to}>{text(crumb.titleKey)}</Link>
									</BreadcrumbLink>
								) : (
									<span>{text(crumb.titleKey)}</span>
								)}
							</BreadcrumbItem>
						</Fragment>
					))}
				</BreadcrumbList>
			</Breadcrumb>
		</header>
	);
}

function ShellFrame({ nav, shown, setShown, children }) {
	const { isMobile } = useSidebar();
	const { groups, current, report, user, pathname } = nav;
	const helpDoc = helpDocOf(pathname, groups);
	return (
		<>
			<a
				href="#content"
				className="tw:sr-only tw:focus:not-sr-only tw:focus:fixed tw:focus:top-2 tw:focus:left-2 tw:focus:z-50 tw:focus:rounded-md tw:focus:bg-background tw:focus:px-3 tw:focus:py-2 tw:focus:text-foreground tw:focus:shadow-md"
			>
				{text("nav.skip-to-content")}
			</a>
			{!isMobile && (
				<AppSidebar
					groups={groups}
					current={current}
					shown={shown}
					report={report}
					user={user}
					helpDoc={helpDoc}
					onShow={setShown}
				/>
			)}
			<SidebarInset className="tw:min-w-0 tw:bg-transparent tw:pb-16 tw:md:pb-0 tw:print:pb-0">
				<ShellHeader
					trail={breadcrumbs(pathname, groups)}
					user={user}
					helpDoc={helpDoc}
					canFold={Boolean(shown?.panel)}
				/>
				{/* the existing pages, in Tabler's page frame: Tailwind's reset stops here (data-legacy-ui) */}
				<div id="content" tabIndex={-1} data-legacy-ui="" className="page tw:flex-1 tw:outline-none">
					{children}
				</div>
			</SidebarInset>
			{isMobile && <PhoneNav groups={groups} current={current} report={report} />}
		</>
	);
}

/**
 * The app's frame for a signed-in user: the rail and its panel on a desktop, the tab bar and its sheet on a phone,
 * the header with the breadcrumbs, and the existing pages inside unchanged. The route decides the active group and
 * page; a rail icon shows another group's pages in the panel until the next navigation.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children  the pages in Tabler's page frame (page-wrapper, page-body, footer)
 */
export function Shell({ children }) {
	const nav = useNavigation();
	// a group picked on the rail, for the route it was picked on
	const [picked, setPicked] = useState(null);
	const shownId = picked?.pathname === nav.pathname ? picked.id : nav.current?.group.id;
	const shown = nav.groups.find((group) => group.id === shownId) ?? null;
	const [defaultOpen] = useState(() => sidebarOpenFromCookie(document.cookie));

	return (
		<TooltipProvider>
			<SidebarProvider
				defaultOpen={defaultOpen}
				style={{ "--sidebar-width": shown?.panel ? WIDTH_WITH_PANEL : WIDTH_RAIL_ONLY }}
			>
				<ShellFrame nav={nav} shown={shown} setShown={(id) => setPicked({ id, pathname: nav.pathname })}>
					{children}
				</ShellFrame>
			</SidebarProvider>
		</TooltipProvider>
	);
}
