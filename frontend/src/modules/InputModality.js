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
