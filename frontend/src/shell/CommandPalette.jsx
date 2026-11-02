import { ExternalLink, Search } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "src/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "src/components/ui/command";
import { Kbd } from "src/components/ui/kbd";
import { useUser } from "src/hooks";
import { intl } from "src/locale";
import { isPaletteShortcut, paletteGroups } from "src/modules/CommandPalette";
import { SECTIONS } from "src/pages/Settings/sections";

const PaletteContext = createContext({ open: false, setOpen: () => {} });

/** Holds whether the palette is open, so the buttons in the top bar and the sidebar header can open it */
export function CommandPaletteProvider({ children }) {
	const [open, setOpen] = useState(false);
	const value = useMemo(() => ({ open, setOpen }), [open]);
	return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

// "⌘ K" on a Mac, "Ctrl K" elsewhere
const shortcutHint = () => (navigator.userAgent.includes("Mac") ? "⌘ K" : "Ctrl K");

/** Opens the palette; below the sm breakpoint only the icon shows */
export function CommandPaletteButton() {
	const { setOpen } = useContext(PaletteContext);
	const label = intl.formatMessage({ id: "palette.button" });
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			className="sm:w-auto sm:px-2.5"
			aria-label={label}
			aria-keyshortcuts="Control+K Meta+K"
			onClick={() => setOpen(true)}
		>
			<Search aria-hidden="true" />
			<span className="hidden text-muted-foreground sm:inline">{label}</span>
			<Kbd className="hidden sm:inline-flex">{shortcutHint()}</Kbd>
		</Button>
	);
}

/** The Ctrl+K / Cmd+K palette: pages and (admins) Settings sections. Mount once inside the provider. */
export function CommandPalette() {
	const { open, setOpen } = useContext(PaletteContext);
	const navigate = useNavigate();
	const { data: user } = useUser("me");

	useEffect(() => {
		const onKeyDown = (event) => {
			if (event.repeat || !isPaletteShortcut(event)) return;
			event.preventDefault();
			setOpen((o) => !o);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [setOpen]);

	const groups = paletteGroups(user, SECTIONS);

	const select = ({ to, external }) => {
		setOpen(false);
		if (external) {
			window.open(to, "_blank", "noopener");
			return;
		}
		void navigate(to);
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title={intl.formatMessage({ id: "palette.title" })}
			description={intl.formatMessage({ id: "palette.description" })}
		>
			<CommandInput placeholder={intl.formatMessage({ id: "palette.placeholder" })} />
			<CommandList>
				<CommandEmpty>{intl.formatMessage({ id: "palette.empty" })}</CommandEmpty>
				{groups.map((group) => (
					<CommandGroup key={group.id} heading={intl.formatMessage({ id: `palette.${group.id}` })}>
						{group.items.map((item) => {
							const label = intl.formatMessage({ id: item.labelKey });
							return (
								// The id keeps equal labels in different groups apart; the label is what the search matches
								<CommandItem
									key={item.id}
									value={`${group.id}:${item.id}`}
									keywords={[label]}
									onSelect={() => select(item)}
								>
									{label}
									{item.external && <ExternalLink className="ml-auto" aria-hidden="true" />}
								</CommandItem>
							);
						})}
					</CommandGroup>
				))}
			</CommandList>
		</CommandDialog>
	);
}
