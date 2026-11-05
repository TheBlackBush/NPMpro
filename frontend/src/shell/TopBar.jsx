import { Separator } from "src/components/ui/separator";
import { CommandPaletteButton } from "./CommandPalette";
import { LanguageMenu } from "./LanguageMenu";
import { LoadingBar } from "./LoadingBar";
import { Logo } from "./Logo";
import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";
import { ThemeMenu } from "./ThemeMenu";
import { UserMenu } from "./UserMenu";

/** Sticky top bar: logo, language, theme and user menus, request progress; the main links in their own row below from lg up (the phone menu below lg) */
export function TopBar() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background supports-[backdrop-filter]:bg-background/97 supports-[backdrop-filter]:backdrop-blur">
			<div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-3 sm:px-5">
				<MobileNav />
				<Logo variant="horizontal" />
				<div className="ml-auto flex items-center gap-0.5 sm:gap-1">
					<CommandPaletteButton />
					<LanguageMenu />
					<ThemeMenu />
					<Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
					<UserMenu variant="topbar" />
				</div>
			</div>
			{/* the separating line spans the whole width, like the header's bottom border; the links stay in the page width */}
			<div className="hidden border-t lg:block">
				<div className="mx-auto max-w-screen-2xl px-5 py-1.5">
					<NavLinks orientation="row" />
				</div>
			</div>
			<LoadingBar />
		</header>
	);
}
