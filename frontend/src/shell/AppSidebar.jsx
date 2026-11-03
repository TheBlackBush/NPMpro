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
import { ThemeMenu } from "./ThemeMenu";
import { UserMenu } from "./UserMenu";
import { useNavItems } from "./useNavItems";

// the active item's marker: a short bar on the left edge, in the page's accent (primary without one)
const MARKER =
	"relative data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full";

// one link of the sidebar, with the active marker in the page's accent
function SidebarLink({ item, active, onNavigate }) {
	const { id, to, label, Icon, external } = item;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild isActive={active} tooltip={label} className={cn(MARKER, navAccent(id).marker)}>
				{external ? (
					<a href={to} target="_blank" rel="noopener" onClick={onNavigate}>
						<Icon aria-hidden="true" />
						<span>{label}</span>
						<ExternalLink className="ml-auto group-data-[collapsible=icon]:hidden" aria-hidden="true" />
					</a>
				) : (
					<NavLink to={to} end={to === "/"} aria-current={active ? "page" : undefined} onClick={onNavigate}>
						<Icon aria-hidden="true" />
						<span>{label}</span>
					</NavLink>
				)}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

/**
 * The sidebar layout's navigation: icon rail when collapsed, a sheet on phones (drawn by the sidebar itself). The
 * bottom holds the language and theme menus, then Settings, then the user menu (user decision 2026-11-03)
 */
export function AppSidebar() {
	const items = useNavItems();
	const { pathname } = useLocation();
	const { setOpenMobile } = useSidebar();
	const closeSheet = () => setOpenMobile(false);
	const main = items.filter((item) => item.id !== "settings");
	const settings = items.find((item) => item.id === "settings");
	const label = intl.formatMessage({ id: "aria.main-navigation" });

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
					<nav aria-label={label}>
						<SidebarMenu>
							{main.map((item) => (
								<SidebarLink
									key={item.id}
									item={item}
									active={isActivePath(pathname, item)}
									onNavigate={closeSheet}
								/>
							))}
						</SidebarMenu>
					</nav>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				{/* side by side, stacked in the icon rail */}
				<div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
					<LanguageMenu />
					<ThemeMenu />
				</div>
				{settings ? (
					// a second landmark with the same name would be ambiguous: Settings is a plain list in the footer
					<SidebarMenu>
						<SidebarLink
							item={settings}
							active={isActivePath(pathname, settings)}
							onNavigate={closeSheet}
						/>
					</SidebarMenu>
				) : null}
				<UserMenu variant="sidebar" />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
