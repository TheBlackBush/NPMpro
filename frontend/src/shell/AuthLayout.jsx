import { BrandMark } from "src/components/BrandMark";
import { cn } from "src/lib/utils";
import { Credits } from "./Credits";
import { LanguageMenu } from "./LanguageMenu";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { ThemeMenu } from "./ThemeMenu";

const WIDTHS = { sm: "max-w-sm", md: "max-w-md" };

/**
 * The frame of the pages shown without a session (Login, Setup, Unhealthy): the logo with the language and theme menus
 * at the column's top right corner, close to the card, the maintenance banner, the page's card and the credits. No router and no session are needed.
 *
 * @param {Object} props
 * @param {"sm"|"md"} [props.width]  the column width: sm for sign-in, md for the longer setup form
 */
export function AuthLayout({ width = "sm", children }) {
	return (
		<div className="flex min-h-svh flex-col bg-muted/40">
			<main className="flex flex-1 flex-col items-center justify-center px-4 pt-6 pb-6">
				<div className={cn("relative flex w-full flex-col gap-6", WIDTHS[width] ?? WIDTHS.sm)}>
					<div className="absolute top-0 right-0 flex gap-1">
						<LanguageMenu />
						<ThemeMenu />
					</div>
					<BrandMark variant="stacked" size={120} alt="NPMpro" className="mx-auto" />
					<MaintenanceBanner className="mb-0" />
					{children}
				</div>
			</main>
			<Credits className="justify-center px-4 py-4" />
		</div>
	);
}
