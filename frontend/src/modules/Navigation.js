import {
	ACCESS_LISTS,
	ADMIN,
	CERTIFICATES,
	DEAD_HOSTS,
	hasPermission,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	STREAMS,
	VIEW,
} from "./Permissions.js";

// The app's main links, in the order the top bar, the sidebar, the phone menu and the command palette show them.
// Users and Audit Log are reached through Settings (spec: Administration group), DNS Credentials through Certificates,
// GoAccess through Monitoring.
export const NAV_ITEMS = Object.freeze([
	{ id: "dashboard", to: "/", labelKey: "dashboard" },
	{ id: "proxy-hosts", to: "/nginx/proxy", labelKey: "proxy-hosts", permissionSection: PROXY_HOSTS },
	{
		id: "redirection-hosts",
		to: "/nginx/redirection",
		labelKey: "redirection-hosts",
		permissionSection: REDIRECTION_HOSTS,
	},
	{ id: "dead-hosts", to: "/nginx/404", labelKey: "dead-hosts", permissionSection: DEAD_HOSTS },
	{ id: "streams", to: "/nginx/stream", labelKey: "streams", permissionSection: STREAMS },
	{ id: "certificates", to: "/certificates", labelKey: "certificates", permissionSection: CERTIFICATES },
	{ id: "access-lists", to: "/access", labelKey: "access-lists", permissionSection: ACCESS_LISTS },
	{ id: "monitoring", to: "/monitoring", labelKey: "monitoring", permissionSection: ADMIN },
	{ id: "settings", to: "/settings", labelKey: "settings", permissionSection: ADMIN },
]);

/**
 * The links a user may open. Monitoring shows while traffic statistics or CrowdSec are on (user.monitoring); with
 * only GoAccess on it points at /goaccess in a new tab until the Monitoring page gets its tabs (PR 6).
 *
 * @param   {{ roles?: string[], permissions?: Object, monitoring?: boolean, goaccess?: boolean }|undefined} user
 * @returns {Array<{ id: string, to: string, labelKey: string, external: boolean }>}
 */
export function visibleNavItems(user) {
	return NAV_ITEMS.flatMap((item) => {
		if (!item.permissionSection) return [{ ...item, external: false }];
		if (!user || !hasPermission(item.permissionSection, VIEW, user.permissions, user.roles)) return [];
		if (item.id === "monitoring") {
			if (user.monitoring) return [{ ...item, external: false }];
			return user.goaccess ? [{ ...item, to: "/goaccess", external: true }] : [];
		}
		return [{ ...item, external: false }];
	});
}
