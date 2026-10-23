import { createContext, useContext, useId } from "react";
import Modal from "react-bootstrap/Modal";

const TitleIdContext = createContext(undefined);

function AppModal({ children, centered = true, ...props }) {
	const titleId = useId();
	return (
		<TitleIdContext.Provider value={titleId}>
			<Modal centered={centered} aria-labelledby={titleId} {...props}>
				{children}
			</Modal>
		</TitleIdContext.Provider>
	);
}

function AppModalTitle({ children, ...props }) {
	const titleId = useContext(TitleIdContext);
	return (
		<Modal.Title id={titleId} {...props}>
			{children}
		</Modal.Title>
	);
}

AppModal.Header = Modal.Header;
AppModal.Title = AppModalTitle;
AppModal.Body = Modal.Body;
AppModal.Footer = Modal.Footer;

export { AppModal };
