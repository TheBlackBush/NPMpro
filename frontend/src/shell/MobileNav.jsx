import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "src/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "src/components/ui/sheet";
import { intl } from "src/locale";
import { LanguageMenu } from "./LanguageMenu";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";

/** The main links in a left sheet below the md breakpoint */
export function MobileNav() {
	const [open, setOpen] = useState(false);
	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="lg:hidden"
					aria-label={intl.formatMessage({ id: "aria.toggle-navigation" })}
				>
					<Menu aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent side="left" className="lg:hidden">
				<SheetHeader>
					<SheetTitle className="flex items-center">
						<Logo variant="horizontal" />
					</SheetTitle>
					<SheetDescription className="sr-only">
						{intl.formatMessage({ id: "aria.main-navigation" })}
					</SheetDescription>
				</SheetHeader>
				<div className="flex-1 overflow-y-auto px-3">
					<NavLinks orientation="column" onNavigate={() => setOpen(false)} />
				</div>
				<SheetFooter className="flex-row items-center border-t">
					<LanguageMenu />
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
