import { ExternalLink } from "lucide-react";
import { NavLink, useLocation } from "react-router";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "src/components/ui/sidebar";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { navAccent } from "src/modules/SectionAccents";
import { LanguageMenu } from "./LanguageMenu";
import { Logo } from "./Logo";
import { isActivePath } from "./NavLinks";
import { UserMenu } from "./UserMenu";
import { useNavItems } from "./useNavItems";

// the active item's marker: a short bar on the left edge, in the page's accent (primary without one)
const MARKER =
	"relative data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full";

/** The sidebar layout's navigation: icon rail when collapsed, a sheet on phones (drawn by the sidebar itself) */
export function AppSidebar() {
	const items = useNavItems();
	const { pathname } = useLocation();
	const { setOpenMobile } = useSidebar();
	const closeSheet = () => setOpenMobile(false);

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
					<Logo variant="horizontal" />
				</div>
				<div className="hidden justify-center group-data-[collapsible=icon]:flex">
					<Logo variant="mark" />
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<nav aria-label={intl.formatMessage({ id: "aria.main-navigation" })}>
						<SidebarMenu>
							{items.map((item) => {
								const { id, to, label, Icon, external } = item;
								const active = isActivePath(pathname, item);
								return (
									<SidebarMenuItem key={id}>
										<SidebarMenuButton
											asChild
											isActive={active}
											tooltip={label}
											className={cn(MARKER, navAccent(id).marker)}
										>
											{external ? (
												<a href={to} target="_blank" rel="noopener" onClick={closeSheet}>
													<Icon aria-hidden="true" />
													<span>{label}</span>
													<ExternalLink
														className="ml-auto group-data-[collapsible=icon]:hidden"
														aria-hidden="true"
													/>
												</a>
											) : (
												<NavLink
													to={to}
													end={to === "/"}
													aria-current={active ? "page" : undefined}
													onClick={closeSheet}
												>
													<Icon aria-hidden="true" />
													<span>{label}</span>
												</NavLink>
											)}
										</SidebarMenuButton>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</nav>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<div className="flex justify-center">
					<LanguageMenu />
				</div>
				<UserMenu variant="sidebar" />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
