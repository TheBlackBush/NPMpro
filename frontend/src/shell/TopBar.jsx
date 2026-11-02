import { Separator } from "src/components/ui/separator";
import { CommandPaletteButton } from "./CommandPalette";
import { LanguageMenu } from "./LanguageMenu";
import { LoadingBar } from "./LoadingBar";
import { Logo } from "./Logo";
import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";
import { UserMenu } from "./UserMenu";

/** Sticky top bar: logo, main links (inline as text from 2xl, a second row from md to 2xl), language and user menus, request progress */
export function TopBar() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-3 sm:px-5">
				<MobileNav />
				<Logo variant="horizontal" />
				{/* The inline links start at 2xl; the second row below covers md up to there. Change both classes together. */}
				<div className="ml-4 hidden 2xl:flex">
					<NavLinks orientation="inline" />
				</div>
				<div className="ml-auto flex items-center gap-0.5 sm:gap-1">
					<CommandPaletteButton />
					<LanguageMenu />
					<Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
					<UserMenu variant="topbar" />
				</div>
			</div>
			<div className="mx-auto hidden max-w-screen-2xl border-t px-5 py-1.5 md:block 2xl:hidden">
				<NavLinks orientation="row" />
			</div>
			<LoadingBar />
		</header>
	);
}
