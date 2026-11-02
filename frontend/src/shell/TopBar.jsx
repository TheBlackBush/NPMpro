import { Separator } from "src/components/ui/separator";
import { LanguageMenu } from "./LanguageMenu";
import { LoadingBar } from "./LoadingBar";
import { Logo } from "./Logo";
import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";
import { UserMenu } from "./UserMenu";

/** Sticky top bar: logo, main links (a second row on tablets), language and user menus, request progress */
export function TopBar() {
	return (
		<header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
			<div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-3 sm:px-5">
				<MobileNav />
				<Logo variant="horizontal" />
				<div className="ml-4 hidden xl:flex">
					<NavLinks orientation="row" />
				</div>
				<div className="ml-auto flex items-center gap-0.5 sm:gap-1">
					<LanguageMenu />
					<Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />
					<UserMenu variant="topbar" />
				</div>
			</div>
			<div className="mx-auto hidden max-w-screen-2xl border-t px-5 py-1.5 md:block xl:hidden">
				<NavLinks orientation="row" />
			</div>
			<LoadingBar />
		</header>
	);
}
