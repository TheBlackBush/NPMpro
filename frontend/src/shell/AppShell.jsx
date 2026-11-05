import { useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "src/components/ui/sidebar";
import { usePreferences } from "src/context";
import { useMediaQuery } from "src/hooks/useMediaQuery";
import { intl } from "src/locale";
import { AUTO_COLLAPSE_BELOW, sidebarOpen, sidebarOpenChange } from "src/modules/SidebarOpen";
import { AppFooter } from "./AppFooter";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette, CommandPaletteButton, CommandPaletteProvider } from "./CommandPalette";
import { LoadingBar } from "./LoadingBar";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { TopBar } from "./TopBar";

/** The signed-in layout: the top bar or the sidebar (a per-user choice), content area, footer, command palette */
export default function AppShell({ children }) {
	return (
		<CommandPaletteProvider>
			{/* Once for both layouts, so Ctrl+K works on every page */}
			<CommandPalette />
			<Layout>{children}</Layout>
		</CommandPaletteProvider>
	);
}

function Layout({ children }) {
	const { navLayout, sidebarCollapsed, setSidebarCollapsed } = usePreferences();
	// below 1024 px the sidebar is the icon rail without touching the saved choice; the trigger opens it for this visit
	const narrow = useMediaQuery(`(max-width: ${AUTO_COLLAPSE_BELOW - 1}px)`);
	const [openedHere, setOpenedHere] = useState(false);
	// crossing the 1024 px line either way returns to the automatic state
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the window crosses the line
	useEffect(() => setOpenedHere(false), [narrow]);
	const page = (
		<>
			<main className="mx-auto w-full max-w-screen-2xl flex-1 px-3 py-5 sm:px-5 sm:py-6">
				<MaintenanceBanner />
				{children}
			</main>
			<AppFooter />
		</>
	);

	if (navLayout === "sidebar") {
		// The TooltipProvider for the sidebar's tooltips is in App.jsx (one for the whole app).
		// Controlled, so the collapse is kept in the preference; the provider's own cookie write is not read
		const onOpenChange = (open) => {
			const change = sidebarOpenChange({ narrow, open });
			if ("openedHere" in change) setOpenedHere(change.openedHere);
			else setSidebarCollapsed(change.collapsedPreference);
		};
		return (
			<SidebarProvider
				open={sidebarOpen({ collapsedPreference: sidebarCollapsed, narrow, openedHere })}
				onOpenChange={onOpenChange}
			>
				<AppSidebar />
				{/* Not SidebarInset: it renders a main element, and the page already has one */}
				<div className="relative flex min-h-dvh w-full min-w-0 flex-1 flex-col bg-background text-foreground">
					<header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-5">
						<SidebarTrigger aria-label={intl.formatMessage({ id: "aria.toggle-navigation" })} />
						<div className="ml-auto flex items-center gap-1">
							<CommandPaletteButton />
						</div>
						<LoadingBar />
					</header>
					{page}
				</div>
			</SidebarProvider>
		);
	}
	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<TopBar />
			{page}
		</div>
	);
}
