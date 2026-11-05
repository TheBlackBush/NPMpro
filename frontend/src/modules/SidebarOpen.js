/**
 * Whether the sidebar shows expanded. From 1024 px up the saved choice (the sidebarCollapsed preference) decides.
 * Below it the sidebar is the icon rail, unless the trigger opened it for this visit (`openedHere`); neither the
 * rail nor that visit's opening ever writes the saved choice. Pure, so node --test checks it (AppShell uses it).
 */
export const AUTO_COLLAPSE_BELOW = 1024;

/**
 * @param   {Object}  state
 * @param   {boolean} state.collapsedPreference  the saved choice
 * @param   {boolean} state.narrow               the window is below AUTO_COLLAPSE_BELOW
 * @param   {boolean} state.openedHere           the trigger opened the sidebar since the window became narrow
 * @returns {boolean}
 */
export const sidebarOpen = ({ collapsedPreference, narrow, openedHere }) =>
	narrow ? openedHere : !collapsedPreference;

/**
 * What the trigger changes: the saved choice from 1024 px up, only this visit's opening below it
 *
 * @param   {Object}  change
 * @param   {boolean} change.narrow  the window is below AUTO_COLLAPSE_BELOW
 * @param   {boolean} change.open    the state the trigger asks for
 * @returns {{ collapsedPreference: boolean } | { openedHere: boolean }}
 */
export const sidebarOpenChange = ({ narrow, open }) => (narrow ? { openedHere: open } : { collapsedPreference: !open });
