// The colour theme: the user's choice (light, dark or "auto" for the system's) and the theme it shows. Kept in
// localStorage (tabler-theme: light, dark, auto); the key keeps its old Tabler name so saved choices survive.

export const THEME_KEY = "tabler-theme";
// set once the stored theme went through the one-time reset to System (UX-34): before B6 the first visit stored the
// system's theme as if the user had chosen it
export const THEME_RESET_KEY = "npmpro-theme-system";
export const THEME_PREFERENCES = Object.freeze(["light", "dark", "auto"]);

/**
 * The stored choice, "auto" (the system's theme) for a missing or unknown value
 *
 * @param   {string|null} value
 * @returns {"light"|"dark"|"auto"}
 */
export const parsePreference = (value) => (THEME_PREFERENCES.includes(value) ? value : "auto");

/**
 * The choice to start with: "auto" until the one-time reset to System has run, the stored choice after it
 *
 * @param   {string|null} stored      localStorage tabler-theme
 * @param   {string|null} resetDone   localStorage npmpro-theme-system
 * @returns {"light"|"dark"|"auto"}
 */
export const startPreference = (stored, resetDone) => (resetDone ? parsePreference(stored) : "auto");

/**
 * The theme a choice shows
 *
 * @param   {string}  preference
 * @param   {boolean} systemDark  prefers-color-scheme: dark matches
 * @returns {"light"|"dark"}
 */
export const resolveTheme = (preference, systemDark) => {
	if (preference === "light" || preference === "dark") return preference;
	return systemDark ? "dark" : "light";
};
