// The user's interface choices, kept per browser in localStorage like the theme (modules/Theme.js). Pure, so
// node --test checks them; context/PreferencesContext.jsx reads and writes them.
export const NAV_KEY = "npmpro-nav";
export const EDITOR_KEY = "npmpro-editor";
export const SIDEBAR_KEY = "npmpro-sidebar-collapsed";
const NAV_LAYOUTS = Object.freeze(["top", "sidebar"]);
const EDITOR_STYLES = Object.freeze(["dialog", "sheet"]);

/** @returns {"top"|"sidebar"} the stored layout, the top bar for a missing or unknown value */
export const parseNavLayout = (value) => (NAV_LAYOUTS.includes(value) ? value : "top");

/** @returns {"dialog"|"sheet"} the stored style of edit windows, the dialog for a missing or unknown value */
export const parseEditorStyle = (value) => (EDITOR_STYLES.includes(value) ? value : "dialog");

/** @returns {boolean} whether the sidebar shows icons only */
export const parseCollapsed = (value) => value === "1";

// Rows per page of the lists, remembered per list
export const PAGE_SIZES = Object.freeze([10, 25, 50, 75, 100]);
export const DEFAULT_PAGE_SIZE = 25;
const BACKUPS_PAGE_SIZE = 10;
export const PAGED_LISTS = Object.freeze([
	"proxy-hosts",
	"redirection-hosts",
	"dead-hosts",
	"streams",
	"certificates",
	"access-lists",
	"backups",
	"audit-log",
]);

/** @returns {string} the storage key of a list's rows per page */
export const pageSizeKey = (list) => `npmpro-page-size-${list}`;

/** @returns {number} the rows per page of a list that has no stored choice: 10 for the stored backups, else 25 */
export const defaultPageSize = (list) => (list === "backups" ? BACKUPS_PAGE_SIZE : DEFAULT_PAGE_SIZE);

/**
 * @param   {string|null} value  the stored text
 * @param   {number} [fallback]  the list's default (defaultPageSize)
 * @returns {number} the stored rows per page, the fallback for a missing, broken or unknown value
 */
export const parsePageSize = (value, fallback = DEFAULT_PAGE_SIZE) => {
	const size = PAGE_SIZES.find((candidate) => String(candidate) === value);
	return size ?? fallback;
};
