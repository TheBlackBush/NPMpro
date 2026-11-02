import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useEffect, useState } from "react";
import { restoreWindowFocus } from "src/modules/FocusReturn";

// Every window records the element that had focus when it opened (read while rendering, before the window's own
// autofocus runs). After it closes, if focus fell to the page body, focus returns there (FocusReturn.returnTarget).
// Radix dialogs and sheets opened from code have no Radix trigger, so they return focus nowhere themselves; the old
// react-bootstrap windows restore it on their own, and then this does nothing.
const create = (Comp) =>
	NiceModal.create((props) => {
		const { visible, remove } = useModal();
		const [opener] = useState(() => document.activeElement);
		useEffect(() => () => restoreWindowFocus(opener), [opener]);
		return <Comp {...props} visible={visible} remove={remove} />;
	});

export default { ...NiceModal, create };
