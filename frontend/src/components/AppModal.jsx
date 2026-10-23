import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import Modal from "react-bootstrap/Modal";

const TitleContext = createContext({ id: undefined, setMounted: () => {} });

function AppModal({ children, centered = true, ...props }) {
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
