import { Languages } from "lucide-react";
import { Button } from "src/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { changeLocale, currentLocale, intl, localeOptions } from "src/locale";
import { returnFocusOnlyForKeyboard } from "src/modules/InputModality";
import localeList from "translations/lang-list.json" with { type: "json" };

/** Picks the interface language; changeLocale stores it and reloads the page */
export function LanguageMenu() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={intl.formatMessage({ id: "aria.select-language" })}>
					<Languages aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				onCloseAutoFocus={returnFocusOnlyForKeyboard}
				align="end"
				className="max-h-[50vh] w-48 overflow-y-auto"
			>
				<DropdownMenuRadioGroup value={currentLocale} onValueChange={changeLocale}>
					{localeOptions.map((code) => (
						<DropdownMenuRadioItem key={code} value={code}>
							{localeList[code].name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
