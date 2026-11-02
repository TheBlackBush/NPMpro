import { visibleNavItems } from "./Navigation.js";
import { isAdmin } from "./Permissions.js";

// Until PR 5 moves them into Settings, Users and Audit Log are reached through the palette (admins only).
const ADMIN_PAGES = Object.freeze([
	{ id: "users", to: "/users", labelKey: "users", external: false },
	{ id: "audit-log", to: "/audit-log", labelKey: "auditlogs", external: false },
]);

/**
 * What the command palette offers: the pages the user may open, then (admins) every Settings section
 *
 * @param   {Object|undefined} user
 * @param   {Array<{ id: string, labelKey: string }>} settingsSections
 */
export function paletteGroups(user, settingsSections) {
	const admin = Boolean(user && isAdmin(user.roles));
	const nav = visibleNavItems(user);
	// GoAccess has no link of its own until the Monitoring tabs (PR 6); the nav model only uses it as a stand-in
	const goaccess =
		user?.goaccess && !nav.some((i) => i.to === "/goaccess")
			? [{ id: "goaccess", to: "/goaccess", labelKey: "goaccess", external: true }]
			: [];
	const pages = { id: "pages", items: [...nav, ...(admin ? ADMIN_PAGES : []), ...goaccess] };
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

/** Ctrl+K, or Cmd+K on a Mac */
export const isPaletteShortcut = (event) => event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
