// The way the user last interacted: "keyboard" after a key press, "pointer" after a mouse, pen or touch press. A
// menu closed by the pointer does not give the focus back to its button: Chrome treats that scripted focus as keyboard
// focus and draws the focus ring on a button the user only clicked.

let last = "pointer";

/** Pure: the modality after an input event of this type */
export function modalityAfter(current, eventType) {
	if (eventType === "keydown") return "keyboard";
	if (eventType === "pointerdown") return "pointer";
	return current;
}

if (typeof document !== "undefined") {
	for (const type of ["keydown", "pointerdown"]) {
		document.addEventListener(
			type,
			(event) => {
				last = modalityAfter(last, event.type);
			},
			{ capture: true, passive: true },
		);
	}
}

/** "keyboard" or "pointer" */
export function lastInput() {
	return last;
}

/**
 * For a Radix menu's onCloseAutoFocus: keeps the default (focus back to the button) after a keyboard close, skips it
 * after a pointer close
 *
 * @param {Event} event
 */
export function returnFocusOnlyForKeyboard(event) {
	if (last !== "keyboard") event.preventDefault();
}

// set on an element that got the focus back after a pointer close: the stylesheet hides its focus ring until a key is
// pressed or the focus moves on
export const QUIET_FOCUS_ATTRIBUTE = "data-focus-quiet";

/** Pure: whether a focus given back after a window closed should hide its ring */
export function quietFocus(input) {
	return input === "pointer";
}

/**
 * Gives the focus back to an element after a window closed: keyboard users go on from there, and after a pointer close
 * the element shows no focus ring (Chrome treats the scripted focus as keyboard focus) until the next key press
 *
 * @param {HTMLElement | null | undefined} element
 */
export function focusBack(element) {
	if (!element) return;
	if (quietFocus(last)) {
		element.setAttribute(QUIET_FOCUS_ATTRIBUTE, "");
		const clear = () => {
			element.removeAttribute(QUIET_FOCUS_ATTRIBUTE);
			element.removeEventListener("blur", clear);
			document.removeEventListener("keydown", clear, true);
		};
		element.addEventListener("blur", clear);
		document.addEventListener("keydown", clear, true);
	}
	element.focus();
}
