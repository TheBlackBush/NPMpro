import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import Modal from "react-bootstrap/Modal";

// the window's onHide (undefined while it cannot close), for parts inside it that handle keys themselves
const HideContext = createContext(undefined);
// true between the window's content box and its body: a <form> there must take part in the content's flex column
const FrameContext = createContext(false);
const TitleContext = createContext({ id: undefined, setMounted: () => {} });

// Windows open at the top, so their top edge stays put when a tab, a step, a choice or a result changes their height.
// A dialog that never changes size (the delete confirmation) may pass `centered`. Below the md breakpoint (phones) a
// window fills the screen (Bootstrap's modal-fullscreen-md-down, UX-33); `fullscreen` sets another breakpoint, or
// false for a window that stays a dialog.
function AppModal({ children, centered = false, fullscreen = "md-down", ...props }) {
	const id = useId();
	const [hasTitle, setHasTitle] = useState(false);
	const value = useMemo(() => ({ id, setMounted: setHasTitle }), [id]);
	return (
		<TitleContext.Provider value={value}>
			<HideContext.Provider value={props.onHide}>
				<FrameContext.Provider value={true}>
					<Modal
						centered={centered}
						fullscreen={fullscreen}
						aria-labelledby={hasTitle ? id : undefined}
						{...props}
					>
						{children}
					</Modal>
				</FrameContext.Provider>
			</HideContext.Provider>
		</TitleContext.Provider>
	);
}

// The window's title as a heading (h2) in Tabler's modal-title size (16px), not react-bootstrap's div styled as h4
function AppModalTitle({ children, ...props }) {
	const { id, setMounted } = useContext(TitleContext);
	useEffect(() => {
		setMounted(true);
		return () => setMounted(false);
	}, [setMounted]);
	return (
		<Modal.Title as="h2" id={id} {...props}>
			{children}
		</Modal.Title>
	);
}

// The body ends the frame: a form inside it (not around header, body and footer) needs no flex classes
function AppModalBody({ children, ...props }) {
	return (
		<Modal.Body {...props}>
			<FrameContext.Provider value={false}>{children}</FrameContext.Provider>
		</Modal.Body>
	);
}

// True for a part placed directly in a window's content box, above its header, body and footer. A form there wraps
// them, so it must be a flex column no taller than the content box (the full screen window of a phone has a fixed
// height): the header and footer stay in view and the body scrolls (HookForm does this).
const useModalFrame = () => useContext(FrameContext);

const useModalHide = () => useContext(HideContext);

AppModal.Header = Modal.Header;
AppModal.Title = AppModalTitle;
AppModal.Body = AppModalBody;
AppModal.Footer = Modal.Footer;

export { AppModal, useModalFrame, useModalHide };
