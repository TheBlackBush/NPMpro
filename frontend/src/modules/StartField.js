// Where a window starts: the first control of its body that can take the focus and shows. Pure, so node --test
// checks the rule without a DOM; AppModal applies it to the elements.

/** The controls a window may start in (hidden inputs are never shown) */
export const START_FIELD_SELECTOR =
	'input:not([type="hidden"]), select, textarea, button, [role="combobox"], [tabindex]:not([tabindex="-1"])';

// Tabs, and the Radix roving focus containers (tab row, radio group, toolbar) that carry a tabindex themselves: the
// focus would land on the container and Radix would move it on to a tab or radio
const NOT_START_ROLES = new Set(["tab", "tablist", "radiogroup", "toolbar"]);

/**
 * True for a control the window may start in: shown, enabled (a View window's disabled fieldset disables all of
 * them) and not a tab or the container of tabs or radios (the tab row comes before the fields of a tabbed editor)
 *
 * @param {{ role: string|null, disabled: boolean, visible: boolean }} control
 */
export function isStartField({ role, disabled, visible }) {
	return visible && !disabled && !NOT_START_ROLES.has(role);
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
