import { cn } from "cn";
import { ChevronsUpDown, CircleHelp, ExternalLink, Languages } from "lucide-react";
import { Link } from "react-router";
import { intl } from "src/locale";
import { showHelpModal } from "src/modals";
import { groupAlert, NAV_GROUPS, pageBadge, pageSections } from "src/modules/Navigation";
import { Avatar, AvatarFallback, AvatarImage } from "src/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "src/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	useSidebar,
} from "src/ui/sidebar";
import { Skeleton } from "src/ui/skeleton";
import { LanguageItems, ThemeItems, UserItems, UserLabel, useThemeChoice } from "./menus";
import { NavIcon } from "./NavIcon";

const text = (id, values) => intl.formatMessage({ id }, values);

/** The logo in the theme's colours: the light file has a dark N, the dark file a white one */
export function LogoMark({ className }) {
	return (
		<>
			<img src="/images/logo-mark-light.svg" alt="" className={cn("tw:dark:hidden", className)} />
			<img src="/images/logo-mark-dark.svg" alt="" className={cn("tw:hidden tw:dark:block", className)} />
		</>
	);
}

/** A page's link: a route of the app, or an external page (GoAccess) in a new tab; other props (from a Slot) pass on */
export function PageLink({ page, active, children, ...props }) {
	if (page.href) {
		return (
			<a href={page.href} target="_blank" rel="noopener noreferrer" {...props}>
				{children}
				<ExternalLink className="tw:ms-auto tw:size-3.5! tw:opacity-60" aria-hidden="true" />
			</a>
		);
	}
	return (
		<Link to={page.to} aria-current={active ? "page" : undefined} {...props}>
			{children}
		</Link>
	);
}

/**
 * A page's count from the host report, red when hosts of it have config errors, warning-coloured when certificates expire; the
 * screen reader hears the reason
 */
export function PageBadge({ badge, className }) {
	if (!badge) return null;
	const tone = badge.errors > 0 ? "error" : badge.expiring > 0 ? "warning" : null;
	return (
		<>
			<SidebarMenuBadge
				className={cn(
					tone === "error" && "tw:bg-destructive/10 tw:text-destructive-text",
					tone === "warning" && "tw:bg-warning/15 tw:text-warning-foreground",
					className,
				)}
			>
				{badge.count}
			</SidebarMenuBadge>
			{badge.errors > 0 && (
				<span className="tw:sr-only">{text("nav.badge.errors", { count: badge.errors })}</span>
			)}
			{badge.expiring > 0 && (
				<span className="tw:sr-only">{text("nav.badge.expiring", { count: badge.expiring })}</span>
			)}
		</>
	);
}

// the mark of a rail icon: a dot when a page of the group needs attention (the panel's badges say why)
const ALERT_DOT = {
	error: "tw:bg-destructive",
	warning: "tw:bg-warning",
};

/** A group's icon on the rail: its link (a group of one page), its pop-out (folded) or the switch of the panel */
function RailItem({ group, isRouteGroup, isShown, collapsed, report, onShow }) {
	const title = text(group.titleKey);
	const alert = groupAlert(group, report);
	const marks = (
		<>
			{isRouteGroup && (
				<span
					aria-hidden="true"
					className="tw:pointer-events-none tw:absolute tw:inset-y-1.5 tw:-left-1.5 tw:w-[3px] tw:rounded-full tw:bg-(image:--brand-gradient-vertical)"
				/>
			)}
			{alert && (
				<span
					aria-hidden="true"
					className={cn(
						"tw:pointer-events-none tw:absolute tw:top-1 tw:right-1 tw:size-2 tw:rounded-full tw:ring-2 tw:ring-sidebar",
						ALERT_DOT[alert],
					)}
				/>
			)}
		</>
	);
	const tooltip = { children: title, hidden: false };

	if (!group.panel) {
		const [page] = group.pages;
		return (
			<SidebarMenuItem>
				<SidebarMenuButton asChild tooltip={tooltip} isActive={isRouteGroup} className="tw:px-2.5 tw:md:px-2">
					<Link to={page.to} aria-current={isRouteGroup ? "page" : undefined}>
						<NavIcon name={group.icon} />
						<span>{title}</span>
					</Link>
				</SidebarMenuButton>
				{marks}
			</SidebarMenuItem>
		);
	}

	if (collapsed) {
		return (
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton tooltip={tooltip} isActive={isRouteGroup} className="tw:px-2.5 tw:md:px-2">
							<NavIcon name={group.icon} />
							<span>{title}</span>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="start" className="tw:w-auto tw:min-w-56">
						{pageSections(group).map((section, index) => (
							<DropdownMenuGroup key={section.id}>
								{index > 0 && <DropdownMenuSeparator />}
								<DropdownMenuLabel>{text(section.titleKey ?? group.titleKey)}</DropdownMenuLabel>
								{section.pages.map((page) => (
									<DropdownMenuItem key={page.id} asChild>
										<PageLink page={page}>
											<NavIcon name={page.icon} />
											{text(page.titleKey)}
										</PageLink>
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				{marks}
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				tooltip={tooltip}
				isActive={isShown}
				aria-pressed={isShown}
				onClick={() => onShow(group.id)}
				className="tw:px-2.5 tw:md:px-2"
			>
				<NavIcon name={group.icon} />
				<span>{title}</span>
			</SidebarMenuButton>
			{marks}
		</SidebarMenuItem>
	);
}

/** The profile menu at the bottom of the rail (shadcn's NavUser of the sidebar-09 block) */
function NavUser({ user }) {
	const { isMobile } = useSidebar();
	const avatar = user?.avatar || "/images/default-avatar.jpg";
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							aria-label={text("aria.user-menu")}
							tooltip={{ children: user?.name, hidden: false }}
							className="tw:data-[state=open]:bg-sidebar-accent tw:data-[state=open]:text-sidebar-accent-foreground tw:md:h-8 tw:md:p-0"
						>
							<Avatar className="tw:size-8 tw:rounded-lg">
								<AvatarImage src={avatar} alt="" />
								<AvatarFallback className="tw:rounded-lg">{user?.name?.charAt(0)}</AvatarFallback>
							</Avatar>
							<div className="tw:grid tw:flex-1 tw:text-left tw:text-sm tw:leading-tight">
								<span className="tw:truncate tw:font-medium">{user?.name}</span>
							</div>
							<ChevronsUpDown className="tw:ml-auto tw:size-4" aria-hidden="true" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="tw:w-auto tw:min-w-56 tw:rounded-lg"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<UserLabel user={user} />
						<DropdownMenuSeparator />
						<UserItems />
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

/** Help for the current page, the language and the theme, above the profile menu */
function RailTools({ helpDoc }) {
	const { Icon, label } = useThemeChoice();
	const helpLabel = text(helpDoc ? "help" : "nav.help-none");
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				{/* aria-disabled, not disabled: the tooltip still says why there is no help */}
				<SidebarMenuButton
					tooltip={{ children: helpLabel, hidden: false }}
					aria-label={helpLabel}
					aria-disabled={!helpDoc}
					onClick={() => helpDoc && showHelpModal(helpDoc)}
					className="tw:px-2.5 tw:md:px-2 tw:aria-disabled:pointer-events-auto"
				>
					<CircleHelp aria-hidden="true" />
					<span>{helpLabel}</span>
				</SidebarMenuButton>
			</SidebarMenuItem>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							tooltip={{ children: text("aria.select-language"), hidden: false }}
							aria-label={text("aria.select-language")}
							className="tw:px-2.5 tw:md:px-2"
						>
							<Languages aria-hidden="true" />
							<span>{text("nav.language")}</span>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="end" className="tw:w-auto tw:min-w-48">
						<LanguageItems />
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							tooltip={{ children: label, hidden: false }}
							aria-label={label}
							className="tw:px-2.5 tw:md:px-2"
						>
							<Icon aria-hidden="true" />
							<span>{label}</span>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="end" className="tw:w-auto tw:min-w-40">
						<ThemeItems />
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

/** The rail's group icons while the user loads: one placeholder per group, in the icons' place */
function RailSkeleton() {
	return NAV_GROUPS.map((group) => (
		<SidebarMenuItem key={group.id} className="tw:flex tw:h-8 tw:items-center tw:justify-center">
			<Skeleton className="tw:size-6 tw:rounded-md" />
		</SidebarMenuItem>
	));
}

/** The panel of the route's group while the user loads: its title and a placeholder row per page */
function PanelSkeleton({ group }) {
	return (
		<Sidebar collapsible="none" className="tw:hidden tw:flex-1 tw:md:flex">
			<SidebarHeader className="tw:h-12 tw:justify-center tw:border-b tw:px-4">
				<h2 className="tw:truncate tw:text-base tw:font-medium tw:text-foreground">{text(group.titleKey)}</h2>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{group.pages.map((page) => (
								<SidebarMenuItem key={page.id}>
									<SidebarMenuSkeleton showIcon />
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}

/** The pages of the shown group, a Settings category under its title */
function Panel({ group, current, report }) {
	return (
		<Sidebar collapsible="none" className="tw:hidden tw:flex-1 tw:md:flex">
			<SidebarHeader className="tw:h-12 tw:justify-center tw:border-b tw:px-4">
				<h2 className="tw:truncate tw:text-base tw:font-medium tw:text-foreground">{text(group.titleKey)}</h2>
			</SidebarHeader>
			<SidebarContent>
				{pageSections(group).map((section) => (
					<SidebarGroup key={section.id}>
						{section.titleKey && <SidebarGroupLabel>{text(section.titleKey)}</SidebarGroupLabel>}
						<SidebarGroupContent>
							<SidebarMenu>
								{section.pages.map((page) => {
									const active = current?.page.id === page.id;
									return (
										<SidebarMenuItem key={page.id}>
											<SidebarMenuButton asChild isActive={active}>
												<PageLink page={page} active={active}>
													<NavIcon name={page.icon} />
													<span>{text(page.titleKey)}</span>
												</PageLink>
											</SidebarMenuButton>
											<PageBadge badge={pageBadge(page, report)} />
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				))}
			</SidebarContent>
		</Sidebar>
	);
}

/**
 * The desktop navigation, shadcn's sidebar-09 block ("Collapsible nested sidebars"): an icon rail with the five
 * groups, the help, language and theme menus and the profile menu, and a panel with the pages of the group shown.
 * Folded (Ctrl+B or the header's button) only the rail stays and a group's icon opens its pages as a pop-out.
 *
 * @param {Object} props
 * @param {Object[]} props.groups      the visible groups (modules/Navigation.js visibleGroups)
 * @param {Object|null} props.current  the route's group and page (locate)
 * @param {Object|null} props.shown    the group whose pages the panel shows
 * @param {Object} [props.report]      the host report, for the badges
 * @param {Object} [props.user]
 * @param {string|null} props.helpDoc  the current page's help document
 * @param {Function} props.onShow      shows a group's pages in the panel (its id)
 * @param {boolean} [props.loading]    the user is not known yet: placeholders for the group icons and, when shown (the
 *                                     route's group) has a panel, for its pages
 */
export function AppSidebar({ groups, current, shown, report, user, helpDoc, onShow, loading = false }) {
	const { state } = useSidebar();
	const collapsed = state === "collapsed";
	return (
		<Sidebar collapsible="icon" className="tw:overflow-hidden">
			<nav
				aria-label={text("aria.main-navigation")}
				aria-busy={loading || undefined}
				className="tw:flex tw:h-full tw:w-full tw:flex-row"
			>
				<Sidebar collapsible="none" className="tw:w-[calc(var(--sidebar-width-icon)+1px)]! tw:border-r">
					<SidebarHeader>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton size="lg" asChild className="tw:md:h-8 tw:md:p-0">
									<Link to="/" aria-label="NPMpro">
										<LogoMark className="tw:size-8" />
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarHeader>
					<SidebarContent>
						<SidebarGroup>
							<SidebarGroupContent className="tw:px-1.5 tw:md:px-0">
								<SidebarMenu className="tw:gap-1">
									{loading ? (
										<RailSkeleton />
									) : (
										groups.map((group) => (
											<RailItem
												key={group.id}
												group={group}
												isRouteGroup={current?.group.id === group.id}
												isShown={shown?.id === group.id}
												collapsed={collapsed}
												report={report}
												onShow={onShow}
											/>
										))
									)}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter>
						<RailTools helpDoc={helpDoc} />
						<NavUser user={user} />
					</SidebarFooter>
				</Sidebar>
				{shown?.panel &&
					(loading ? (
						<PanelSkeleton group={shown} />
					) : (
						<Panel group={shown} current={current} report={report} />
					))}
			</nav>
		</Sidebar>
	);
}
