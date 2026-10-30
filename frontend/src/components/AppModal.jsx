import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import Modal from "react-bootstrap/Modal";

const TitleContext = createContext({ id: undefined, setMounted: () => {} });

// Windows open at the top, so their top edge stays put when a tab, a step, a choice or a result changes their height.
// A dialog that never changes size (the delete confirmation) may pass `centered`.
function AppModal({ children, centered = false, ...props }) {
	const id = useId();
	const [hasTitle, setHasTitle] = useState(false);
	const value = useMemo(() => ({ id, setMounted: setHasTitle }), [id]);
	return (
		<TitleContext.Provider value={value}>
			<Modal centered={centered} aria-labelledby={hasTitle ? id : undefined} {...props}>
				{children}
			</Modal>
		</TitleContext.Provider>
	);
}

function AppModalTitle({ children, ...props }) {
	const { id, setMounted } = useContext(TitleContext);
	useEffect(() => {
		setMounted(true);
		return () => setMounted(false);
	}, [setMounted]);
	return (
		<Modal.Title id={id} {...props}>
			{children}
		</Modal.Title>
	);
}

AppModal.Header = Modal.Header;
AppModal.Title = AppModalTitle;
AppModal.Body = Modal.Body;
AppModal.Footer = Modal.Footer;

export { AppModal };
