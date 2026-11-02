import { XIcon } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "src/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "src/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "src/components/ui/sheet";
import { usePreferences } from "src/context/PreferencesContext";
import { useIsMobile } from "src/hooks/use-mobile";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { useWindowFocusReturn } from "src/modules/easyModal";
import { canClose, dialogWidthClass, sheetWidthClass, windowMode } from "src/modules/WindowFrame";

// the window's onHide (undefined while it cannot close), for parts inside it that handle keys themselves
const HideContext = createContext(undefined);
// true between the window's content box and its body: a <form> there must take part in the content's flex column
const FrameContext = createContext(false);
const TitleContext = createContext({ setMounted: () => {} });
// which element renders the title (a dialog's or a sheet's), and whether the header shows a close button
const ModeContext = createContext("dialog");

// A target the window must not treat as "outside": toasts and other windows stacked on top of it
const STACKED = '[data-sonner-toaster], [role="dialog"]';

// Windows open at the top (a dialog) or at the right edge (a sheet, by the user's preference), so their position stays
// put when a tab, a step, a choice or a result changes their height. On phones, and for sizes that are not "sm", the
// preference is ignored where it says so (WindowFrame.windowMode): phones always get a full screen window.
// Props follow the old react-bootstrap window: show, onHide (undefined: the window cannot close, it is saving),
// size ("sm", "lg", "xl"), backdrop ("static" ignores clicks outside), keyboard (false ignores Escape).
// `scrollable`, `centered` and `fullscreen` are accepted and ignored: the body always scrolls between a fixed header and
// footer, windows open at the top, and phones always get a full screen window.
function AppModal({
	children,
	show,
	onHide,
	size,
	backdrop,
	keyboard = true,
	scrollable: _scrollable,
	centered: _centered,
	fullscreen: _fullscreen,
	className,
	...props
}) {
	const [hasTitle, setHasTitle] = useState(false);
	const value = useMemo(() => ({ setMounted: setHasTitle }), []);
	const { editorStyle } = usePreferences();
	const isPhone = useIsMobile();
	const mode = windowMode({ editorStyle, size, isPhone });
	const giveFocusBack = useWindowFocusReturn();

	const request = (reason) => canClose({ onHide, backdrop, reason });
	const guards = {
		// Escape, a click outside, or focus that moved to a toast or a stacked window must not close a window that cannot
		onEscapeKeyDown: (event) => {
			if (keyboard === false || !request("escape")) event.preventDefault();
		},
		onPointerDownOutside: (event) => {
			const target = event.detail.originalEvent.target;
			if (!request("outside") || target?.closest?.(STACKED)) event.preventDefault();
		},
		// intentional: focus leaving the window (to a toast, a stacked layer, the browser UI) never closes it
		onFocusOutside: (event) => event.preventDefault(),
		// Radix would focus what was focused when the window mounted (the page body on Safari): the opener instead
		onCloseAutoFocus: (event) => {
			event.preventDefault();
			giveFocusBack?.();
		},
		"aria-describedby": undefined,
		...props,
	};
	// Radix reports Escape, outside clicks and the close button as one change; the first two were filtered above
	const onOpenChange = (open) => {
		if (!open && request("close-button")) onHide?.();
	};

	// a window without an AppModal.Title yet (loading) still needs a name for Radix and screen readers
	const fallbackTitle = hasTitle ? null : (
		<span className="sr-only">
			{mode === "sheet" ? (
				<SheetTitle>{intl.formatMessage({ id: "loading" })}</SheetTitle>
			) : (
				<DialogTitle>{intl.formatMessage({ id: "loading" })}</DialogTitle>
			)}
		</span>
	);
	const frame = "flex min-h-0 flex-col gap-0 p-0";
	return (
		<TitleContext.Provider value={value}>
			<HideContext.Provider value={onHide}>
				<FrameContext.Provider value={true}>
					<ModeContext.Provider value={mode}>
						{mode === "sheet" ? (
							<Sheet open={Boolean(show)} onOpenChange={onOpenChange}>
								<SheetContent
									side="right"
									showCloseButton={false}
									className={cn(frame, "w-full gap-0", sheetWidthClass(size), className)}
									{...guards}
								>
									{fallbackTitle}
									{children}
								</SheetContent>
							</Sheet>
						) : (
							<Dialog open={Boolean(show)} onOpenChange={onOpenChange}>
								<DialogContent
									showCloseButton={false}
									className={cn(
										frame,
										"top-4 max-h-[calc(100dvh-2rem)] -translate-y-0 overflow-hidden",
										mode === "fullscreen"
											? "top-0 left-0 h-dvh max-h-none w-full max-w-none translate-x-0 rounded-none sm:max-w-none"
											: dialogWidthClass(size),
										className,
									)}
									{...guards}
								>
									{fallbackTitle}
									{children}
								</DialogContent>
							</Dialog>
						)}
					</ModeContext.Provider>
				</FrameContext.Provider>
			</HideContext.Provider>
		</TitleContext.Provider>
	);
}

// Title row; with closeButton a translated X that closes through the window's onHide
function AppModalHeader({ children, closeButton = false, className, ...props }) {
	const onHide = useContext(HideContext);
	return (
		<div
			data-slot="window-header"
			className={cn("flex shrink-0 items-center gap-2 border-b px-4 py-3", className)}
			{...props}
		>
			<div className="min-w-0 flex-1">{children}</div>
			{closeButton && onHide ? (
				<DialogClose asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={intl.formatMessage({ id: "aria.close" })}
					>
						<XIcon />
					</Button>
				</DialogClose>
			) : null}
		</div>
	);
}

// The window's title as a heading (Radix renders an h2), labelling the window
function AppModalTitle({ children, className, ...props }) {
	const { setMounted } = useContext(TitleContext);
	const mode = useContext(ModeContext);
	useEffect(() => {
		setMounted(true);
		return () => setMounted(false);
	}, [setMounted]);
	const Title = mode === "sheet" ? SheetTitle : DialogTitle;
	return (
		<Title className={cn("text-base font-medium leading-snug", className)} {...props}>
			{children}
		</Title>
	);
}

// The body ends the frame: a form inside it (not around header, body and footer) needs no flex classes. It scrolls
// between the fixed header and footer.
function AppModalBody({ children, className, ...props }) {
	return (
		<div
			data-slot="window-body"
			data-window-body=""
			className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)}
			{...props}
		>
			<FrameContext.Provider value={false}>{children}</FrameContext.Provider>
		</div>
	);
}

// Fixed at the bottom, buttons on the right
function AppModalFooter({ children, className, ...props }) {
	return (
		<div
			data-slot="window-footer"
			className={cn(
				"flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/50 px-4 py-3",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

// True for a part placed directly in a window's content box, above its header, body and footer. A form there wraps
// them, so it must be a flex column no taller than the content box (the full screen window of a phone has a fixed
// height): the header and footer stay in view and the body scrolls (HookForm does this).
const useModalFrame = () => useContext(FrameContext);

const useModalHide = () => useContext(HideContext);

AppModal.Header = AppModalHeader;
AppModal.Title = AppModalTitle;
AppModal.Body = AppModalBody;
AppModal.Footer = AppModalFooter;

export { AppModal, useModalFrame, useModalHide };
