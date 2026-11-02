import { AppFooter } from "./AppFooter";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { TopBar } from "./TopBar";

/** The signed-in layout: top bar, content area, footer */
export default function AppShell({ children }) {
	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<TopBar />
			<main className="mx-auto w-full max-w-screen-2xl flex-1 px-3 py-5 sm:px-5 sm:py-6">
				<MaintenanceBanner />
				{children}
			</main>
			<AppFooter />
		</div>
	);
}
