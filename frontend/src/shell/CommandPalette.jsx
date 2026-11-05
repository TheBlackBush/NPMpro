import { ExternalLink, Search } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "src/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "src/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "src/components/ui/dialog";
import { Kbd } from "src/components/ui/kbd";
import { confirmLeave, useUser } from "src/hooks";
import { intl } from "src/locale";
import { isPaletteShortcut, paletteGroups } from "src/modules/CommandPalette";
import { SECTIONS } from "src/pages/Settings/sections";

const PaletteContext = createContext({ open: false, setOpen: () => {}, openerRef: { current: null } });

/** Holds whether the palette is open, so the buttons in the top bar and the sidebar header can open it */
export function CommandPaletteProvider({ children }) {
	const [open, setOpen] = useState(false);
	// what had the focus when the palette opened (the button, or after the shortcut whatever was focused): the palette
	// gives the focus back to it when it closes
	const openerRef = useRef(null);
	const value = useMemo(() => ({ open, setOpen, openerRef }), [open]);
	return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

// "⌘ K" on a Mac, "Ctrl K" elsewhere
const shortcutHint = () => (navigator.userAgent.includes("Mac") ? "⌘ K" : "Ctrl K");

/** Opens the palette; below the sm breakpoint only the icon shows */
export function CommandPaletteButton() {
	const { setOpen, openerRef } = useContext(PaletteContext);
	const label = intl.formatMessage({ id: "palette.button" });
	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			className="gap-2 sm:w-auto sm:px-2.5"
			aria-label={label}
			aria-keyshortcuts="Control+K Meta+K"
			onClick={(event) => {
				// the button itself: Safari does not focus a clicked button
				openerRef.current = event.currentTarget;
				setOpen(true);
			}}
		>
			<Search aria-hidden="true" />
			<span className="hidden text-muted-foreground sm:inline">{label}</span>
			<Kbd className="hidden sm:inline-flex">{shortcutHint()}</Kbd>
		</Button>
	);
}

/** The Ctrl+K / Cmd+K palette: pages and (admins) Settings sections. Mount once inside the provider. */
export function CommandPalette() {
	const { open, setOpen, openerRef } = useContext(PaletteContext);
	const navigate = useNavigate();
	const { data: user } = useUser("me");

	useEffect(() => {
		const onKeyDown = (event) => {
			if (event.repeat || !isPaletteShortcut(event)) return;
			event.preventDefault();
			if (!open) openerRef.current = document.activeElement;
			setOpen((o) => !o);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, setOpen, openerRef]);

	const groups = paletteGroups(user, SECTIONS);

	const select = async ({ to, external }) => {
		setOpen(false);
		if (external) {
			window.open(to, "_blank", "noopener");
			return;
		}
		// like the links: a page with unsaved changes asks first
		if (await confirmLeave()) void navigate(to);
	};

	return (
		// Composed here instead of CommandDialog, which renders its title and description outside the dialog content
		// (they would sit in the page while the palette is closed); the classes are CommandDialog's
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent
				className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
				showCloseButton={false}
				onCloseAutoFocus={(event) => {
					// Radix has no trigger to return to here
					const opener = openerRef.current;
					openerRef.current = null;
					if (opener?.isConnected && opener !== document.body) {
						event.preventDefault();
						opener.focus();
					}
				}}
			>
				<DialogTitle className="sr-only">{intl.formatMessage({ id: "palette.title" })}</DialogTitle>
				<DialogDescription className="sr-only">
					{intl.formatMessage({ id: "palette.description" })}
				</DialogDescription>
				<Command>
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
											onSelect={() => void select(item)}
										>
											{label}
											{item.external && <ExternalLink className="ml-auto" aria-hidden="true" />}
										</CommandItem>
									);
								})}
							</CommandGroup>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
