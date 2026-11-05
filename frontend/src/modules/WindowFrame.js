// Which kind of window an AppModal renders, and when it may close. Pure, so the rules are unit tested.

/** "fullscreen" on phones, "dialog" for small windows, else the user's preference ("sheet" or "dialog") */
function windowMode({ editorStyle, size, isPhone }) {
	if (isPhone) return "fullscreen";
	if (size === "sm") return "dialog";
	return editorStyle === "sheet" ? "sheet" : "dialog";
}

/**
 * The Radix primitive a window is built on: "sheet" when the user prefers side sheets (not for small windows), else
 * "dialog". It does not depend on the screen width, so a window that crosses the phone breakpoint while open (a
 * rotated tablet, a resized browser) keeps its tree and the form in it keeps its edits; only the classes change (a
 * phone gets the primitive full screen).
 */
function windowPrimitive({ editorStyle, size }) {
	return editorStyle === "sheet" && size !== "sm" ? "sheet" : "dialog";
}

/**
 * Whether a close request is honoured. reason: "escape", "outside" or "close-button".
 * No onHide means the window cannot close (it is saving); a static backdrop ignores clicks outside.
 */
function canClose({ onHide, backdrop, reason }) {
	if (!onHide) return false;
	return !(reason === "outside" && backdrop === "static");
}

/**
 * Whether a click outside a window that refuses it plays the short bump (the feedback of a static backdrop). Not for
 * a full screen window (nothing outside to click), a click on a stacked layer (a toast, another window) or when the
 * user asks for reduced motion.
 */
function bumpsOnOutside({ mode, refused, stacked, reducedMotion }) {
	return refused && !stacked && !reducedMotion && mode !== "fullscreen";
}

/** Dialog width from the size prop (full class names, so Tailwind finds them) */
function dialogWidthClass(size) {
	if (size === "sm") return "sm:max-w-md";
	if (size === "lg") return "sm:max-w-3xl";
	if (size === "xl") return "sm:max-w-5xl";
	return "sm:max-w-2xl";
}

// a sheet on a phone fills the screen like the full screen dialog; the base classes it replaces carry the same
// data-[side=right] variant (they would win over plain ones)
const FULLSCREEN_SHEET =
	"left-0 data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none";

/** Sheet width from the size prop ("full": a phone's full screen sheet) */
function sheetWidthClass(size) {
	// the sheet base sets data-[side=right]:sm:max-w-sm, which tailwind-merge only replaces with the same variant set
	if (size === "full") return FULLSCREEN_SHEET;
	if (size === "lg") return "data-[side=right]:sm:max-w-2xl";
	if (size === "xl") return "data-[side=right]:sm:max-w-4xl";
	return "data-[side=right]:sm:max-w-xl";
}

export { bumpsOnOutside, canClose, dialogWidthClass, sheetWidthClass, windowMode, windowPrimitive };
