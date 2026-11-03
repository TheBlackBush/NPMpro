import { visibleNavItems } from "./Navigation.js";
import { isAdmin } from "./Permissions.js";

/**
 * What the command palette offers: the pages the user may open, then (admins) every Settings section, Users and Audit Log among them
 *
 * @param   {Object|undefined} user
 * @param   {Array<{ id: string, labelKey: string }>} settingsSections
 */
export function paletteGroups(user, settingsSections) {
	const admin = Boolean(user && isAdmin(user.roles));
	const nav = visibleNavItems(user);
	// a quick way to the GoAccess report, next to the Monitoring page (where it is also the last tab)
	const goaccess = user?.goaccess ? [{ id: "goaccess", to: "/goaccess", labelKey: "goaccess", external: true }] : [];
	const pages = { id: "pages", items: [...nav, ...goaccess] };
	if (!admin) return [pages];
	const settings = {
		id: "settings",
		items: settingsSections.map((s) => ({
			id: s.id,
			to: `/settings/${s.id}`,
			labelKey: s.labelKey,
			external: false,
		})),
	};
	return [pages, settings];
}

/**
 * Ctrl+K, or Cmd+K on a Mac. The physical key counts too: on a Cyrillic or other non-Latin layout Ctrl+K reports
 * another character. Browser autofill dispatches keydown events without key and code.
 */
export const isPaletteShortcut = (event) =>
	(event.key?.toLowerCase() === "k" || event.code === "KeyK") &&
	Boolean(event.ctrlKey || event.metaKey) &&
	!event.altKey &&
	!event.shiftKey;
