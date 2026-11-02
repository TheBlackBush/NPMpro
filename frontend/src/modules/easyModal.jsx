import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { createContext, useContext, useEffect, useState } from "react";
import { pickOpener, restoreWindowFocus, trackPressed } from "src/modules/FocusReturn";

// Every window records the element it opened from (read while rendering, before the window's own autofocus runs):
// the focused element, or on Safari (a click does not focus a button there) the control pressed last. After the
// window closes, if focus fell to the page body, focus returns there (FocusReturn.returnTarget).
// Radix windows have no Radix trigger, so Radix itself would focus what was focused at mount (the body on Safari);
// AppModal takes over through useWindowFocusReturn.
const lastPressed = trackPressed(document);

const OpenerContext = createContext(null);

// A function that gives focus back to the window's opener; null outside an easyModal window
const useWindowFocusReturn = () => useContext(OpenerContext);

const create = (Comp) =>
	NiceModal.create((props) => {
		const { visible, remove } = useModal();
		const [opener] = useState(() => pickOpener(document, lastPressed()));
		useEffect(() => () => restoreWindowFocus(opener), [opener]);
		const [giveBack] = useState(() => () => restoreWindowFocus(opener));
		return (
			<OpenerContext.Provider value={giveBack}>
				<Comp {...props} visible={visible} remove={remove} />
			</OpenerContext.Provider>
		);
	});

export { useWindowFocusReturn };
export default { ...NiceModal, create };
