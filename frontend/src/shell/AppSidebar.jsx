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
import { intl } from "src/locale";
import { LanguageMenu } from "./LanguageMenu";
import { Logo } from "./Logo";
import { isActivePath } from "./NavLinks";
import { UserMenu } from "./UserMenu";
import { useNavItems } from "./useNavItems";

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
					{/* The command palette button goes here */}
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
										<SidebarMenuButton asChild isActive={active} tooltip={label}>
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
