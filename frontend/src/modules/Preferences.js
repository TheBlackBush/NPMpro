// The user's interface choices, kept per browser in localStorage like the theme (modules/Theme.js). Pure, so
// node --test checks them; context/PreferencesContext.jsx reads and writes them.
export const NAV_KEY = "npmpro-nav";
export const EDITOR_KEY = "npmpro-editor";
export const SIDEBAR_KEY = "npmpro-sidebar-collapsed";
export const NAV_LAYOUTS = Object.freeze(["top", "sidebar"]);
export const EDITOR_STYLES = Object.freeze(["dialog", "sheet"]);

/** @returns {"top"|"sidebar"} the stored layout, the top bar for a missing or unknown value */
export const parseNavLayout = (value) => (NAV_LAYOUTS.includes(value) ? value : "top");

/** @returns {"dialog"|"sheet"} the stored style of edit windows, the dialog for a missing or unknown value */
export const parseEditorStyle = (value) => (EDITOR_STYLES.includes(value) ? value : "dialog");

/** @returns {boolean} whether the sidebar shows icons only */
export const parseCollapsed = (value) => value === "1";
