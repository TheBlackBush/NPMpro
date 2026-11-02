// Which kind of window an AppModal renders, and when it may close. Pure, so the rules are unit tested.

/** "fullscreen" on phones, "dialog" for small windows, else the user's preference ("sheet" or "dialog") */
function windowMode({ editorStyle, size, isPhone }) {
	if (isPhone) return "fullscreen";
	if (size === "sm") return "dialog";
	return editorStyle === "sheet" ? "sheet" : "dialog";
}

/**
 * Whether a close request is honoured. reason: "escape", "outside" or "close-button".
 * No onHide means the window cannot close (it is saving); a static backdrop ignores clicks outside.
 */
function canClose({ onHide, backdrop, reason }) {
	if (!onHide) return false;
	return !(reason === "outside" && backdrop === "static");
}

/** Dialog width from the size prop (full class names, so Tailwind finds them) */
function dialogWidthClass(size) {
	if (size === "sm") return "sm:max-w-md";
	if (size === "lg") return "sm:max-w-3xl";
	if (size === "xl") return "sm:max-w-5xl";
	return "sm:max-w-2xl";
}

/** Sheet width from the size prop */
function sheetWidthClass(size) {
	// the sheet base sets data-[side=right]:sm:max-w-sm, which tailwind-merge only replaces with the same variant set
	if (size === "lg") return "data-[side=right]:sm:max-w-2xl";
	if (size === "xl") return "data-[side=right]:sm:max-w-4xl";
	return "data-[side=right]:sm:max-w-xl";
}

export { canClose, dialogWidthClass, sheetWidthClass, windowMode };
