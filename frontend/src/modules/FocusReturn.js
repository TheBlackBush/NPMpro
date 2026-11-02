// Where keyboard focus goes back to after a row action or a window, when the element that had it is gone.
//
// A row's action menu button carries data-row-actions="<key>" (for instance proxy-host-12). The row may re-render,
// move after a re-sort or exist twice (the phone and the desktop copy, one hidden), so the button is found again by
// its key: the first visible match. The list page heading (data-list-heading, tabIndex -1) is the last fallback.

const ROW_ACTIONS_ATTR = "data-row-actions";
const LIST_HEADING_SELECTOR = "[data-list-heading]";

// CSS.escape exists in every supported browser; the fallback only serves the unit tests
const escapeValue = (value) =>
	globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/gu, "\\$&");

/** The selector of the row action buttons with this key */
function rowActionsSelector(key) {
	return `[${ROW_ACTIONS_ATTR}="${escapeValue(key)}"]`;
}

function isVisible(element) {
	return element.checkVisibility?.() ?? element.offsetParent !== null;
}

/**
 * True when nothing useful has focus: the focused element was removed or moved so the browser fell back to the body,
 * or WebKit still reports an element of a window that has already closed (stale activeElement).
 */
function focusLost(doc) {
	const active = doc.activeElement;
	return !active || active === doc.body || Boolean(active.closest?.('[data-state="closed"]'));
}

/**
 * The element a window should give focus back to. Safari (and Firefox on macOS) do not focus a button on click, so
 * document.activeElement is the body when a window opens from a click. The last pressed control (lastPressed) is the
 * opener then.
 */
function pickOpener(doc, lastPressed) {
	const active = doc.activeElement;
	if (active && active !== doc.body) return active;
	return lastPressed?.isConnected ? lastPressed : active;
}

const PRESSABLE = 'button, a[href], [role="button"], [role="menuitem"], [tabindex]';

/** Starts remembering the control that was pressed last (capture phase, so no handler can hide it); returns a reader */
function trackPressed(doc) {
	let last = null;
	doc.addEventListener(
		"pointerdown",
		(event) => {
			last = event.target?.closest?.(PRESSABLE) ?? null;
		},
		true,
	);
	return () => last;
}

/** The first visible row action button with this key, or null */
function findRowActions(doc, key) {
	if (!key) return null;
	for (const element of doc.querySelectorAll(rowActionsSelector(key))) {
		if (isVisible(element)) return element;
	}
	return null;
}

/**
 * Where focus returns to after a window closes: the element that had focus when it opened if it is still in the
 * page, else the visible twin of that row action button, else the list page heading (null if there is none).
 */
function returnTarget(doc, captured) {
	const usable = captured && captured !== doc.body;
	if (usable && captured.isConnected) return captured;
	const twin = usable ? findRowActions(doc, captured.getAttribute?.(ROW_ACTIONS_ATTR)) : null;
	return twin ?? doc.querySelector(LIST_HEADING_SELECTOR);
}

/** Runs fn after the next paint and after the timers queued so far (Radix and query updates use setTimeout 0) */
function afterPaint(fn) {
	requestAnimationFrame(() => setTimeout(fn, 0));
}

/** After a row action settles: if focus fell to the body, put it on the row's action button again */
function restoreRowFocus(key) {
	afterPaint(() => {
		if (focusLost(document)) findRowActions(document, key)?.focus();
	});
}

/** After a window closed: if focus fell to the body, put it on returnTarget(captured) */
function restoreWindowFocus(captured) {
	afterPaint(() => {
		if (focusLost(document)) returnTarget(document, captured)?.focus();
	});
}

export {
	afterPaint,
	findRowActions,
	focusLost,
	pickOpener,
	ROW_ACTIONS_ATTR,
	restoreRowFocus,
	restoreWindowFocus,
	returnTarget,
	rowActionsSelector,
	trackPressed,
};
