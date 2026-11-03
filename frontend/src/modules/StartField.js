// Where a window starts: the first control of its body that can take the focus and shows. Pure, so node --test
// checks the rule without a DOM; AppModal applies it to the elements.

/** The controls a window may start in (hidden inputs are never shown) */
export const START_FIELD_SELECTOR =
	'input:not([type="hidden"]), select, textarea, button, [role="combobox"], [tabindex]:not([tabindex="-1"])';

// A tab: the active one is in the tab order but is not a field (the tab row comes before the fields of a tabbed editor)
const NOT_START_ROLES = new Set(["tab"]);

/**
 * True for a control the window may start in: shown, enabled (a View window's disabled fieldset disables all of
 * them), in the tab order (Radix gives the unchecked radios of a group tabindex -1), not a tab, and not a container
 * of other controls. A focusable container (a tab panel, a tab row, a radio group, a toolbar) carries a tabindex and
 * comes before its own fields in document order; it is skipped even when all its fields are disabled, so a View
 * window keeps the focus on the window.
 *
 * @param {{ role: string|null, disabled: boolean, visible: boolean, tabIndex: number, containsField: boolean }} control
 *   containsField: the element contains another element that matches START_FIELD_SELECTOR, disabled or not
 */
export function isStartField({ role, disabled, visible, tabIndex, containsField }) {
	return visible && !disabled && !(tabIndex < 0) && !containsField && !NOT_START_ROLES.has(role);
}

/**
 * True when the window must leave the focus alone: on a phone (a focused text field opens the on-screen keyboard over
 * the window), or when the focus is no longer on the window element itself (the user clicked or tabbed, or a field
 * already has it)
 *
 * @param {{ isPhone: boolean, activeIsWindow: boolean }} state
 */
export function keepsWindowFocus({ isPhone, activeIsWindow }) {
	return isPhone || !activeIsWindow;
}
