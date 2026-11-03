import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "src/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { useThemeState } from "src/context";
import { intl } from "src/locale";
import { returnFocusOnlyForKeyboard } from "src/modules/InputModality";

// the choices in the menu's order: the stored value, its name and its icon
const CHOICES = [
	{ value: "light", labelId: "theme.light", Icon: Sun },
	{ value: "dark", labelId: "theme.dark", Icon: Moon },
	{ value: "auto", labelId: "theme.system", Icon: Monitor },
];

/** Picks the theme (Light, Dark or System); the button shows the chosen one's icon. Sits next to the LanguageMenu */
export function ThemeMenu() {
	const { preference, setPreference } = useThemeState();
	const current = CHOICES.find((choice) => choice.value === preference) ?? CHOICES[2];
	const label = intl.formatMessage({ id: "theme.label" }, { theme: intl.formatMessage({ id: current.labelId }) });

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={label} title={label}>
					<current.Icon aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent onCloseAutoFocus={returnFocusOnlyForKeyboard} align="end" className="w-40">
				<DropdownMenuRadioGroup value={preference} onValueChange={setPreference}>
					{CHOICES.map(({ value, labelId, Icon }) => (
						<DropdownMenuRadioItem key={value} value={value}>
							<Icon aria-hidden="true" />
							{intl.formatMessage({ id: labelId })}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
