/**
 * The app's navigation: five groups of pages, the single source for the rail and its panel, the phone tabs and their
 * sheet, the breadcrumbs and the command palette. Plain data and pure functions, so node --test checks them.
 *
 * A page: id, route (to) or an external link (href), title (titleKey, a ui/en.json key), icon (a name the shell maps
 * to a lucide icon), the permission it needs (section, VIEW as modules/Permissions.js), a flag of the user it needs
 * (when: monitoring or goaccess, as the user object of /api/users/me has them), its help document and its badge (a
 * count of the host report, GET /api/reports/hosts).
 */
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
import { SETTINGS_CATEGORIES, SETTINGS_SECTIONS, settingsHelpDoc } from "./SettingsSections.js";

// the Settings sections' icons (lucide names), by section id
const SETTINGS_ICONS = {
	"default-site": "Globe",
	network: "Network",
	nginx: "ServerCog",
	authentication: "LockKeyhole",
	"forward-auth": "ShieldCheck",
	certificates: "FileBadge",
	monitoring: "ChartColumn",
	geoip: "Earth",
	backup: "DatabaseBackup",
	database: "Database",
	advanced: "SlidersHorizontal",
	environment: "ListTree",
};

export const NAV_GROUPS = [
	{
		id: "overview",
		titleKey: "nav.overview",
		icon: "LayoutDashboard",
		// one page: the rail icon opens it, no panel
		panel: false,
		pages: [{ id: "dashboard", to: "/", titleKey: "dashboard", icon: "LayoutDashboard" }],
	},
	{
		id: "hosts",
		titleKey: "hosts",
		icon: "Server",
		panel: true,
		pages: [
			{
				id: "proxy-hosts",
				to: "/nginx/proxy",
				titleKey: "proxy-hosts",
				icon: "Zap",
				section: PROXY_HOSTS,
				help: "ProxyHosts",
				badge: "proxy",
			},
			{
				id: "redirection-hosts",
				to: "/nginx/redirection",
				titleKey: "redirection-hosts",
				icon: "Shuffle",
				section: REDIRECTION_HOSTS,
				help: "RedirectionHosts",
				badge: "redirection",
			},
			{
				id: "dead-hosts",
				to: "/nginx/404",
				titleKey: "dead-hosts",
				icon: "ZapOff",
				section: DEAD_HOSTS,
				help: "DeadHosts",
				badge: "dead",
			},
			{
				id: "streams",
				to: "/nginx/stream",
				titleKey: "streams",
				icon: "Disc",
				section: STREAMS,
				help: "Streams",
				badge: "stream",
			},
		],
	},
	{
		id: "security",
		titleKey: "nav.security",
		icon: "ShieldCheck",
		panel: true,
		pages: [
			{
				id: "certificates",
				to: "/certificates",
				titleKey: "certificates",
				icon: "BadgeCheck",
				section: CERTIFICATES,
				help: "Certificates",
				badge: "certificate",
			},
			{
				id: "dns-credentials",
				to: "/certificates/dns-credentials",
				titleKey: "dns-credentials",
				icon: "KeyRound",
				section: CERTIFICATES,
			},
			{
				id: "access-lists",
				to: "/access",
				titleKey: "access-lists",
				icon: "Lock",
				section: ACCESS_LISTS,
				help: "AccessLists",
				badge: "accessList",
			},
		],
	},
	{
		id: "monitoring",
		titleKey: "monitoring",
		icon: "Activity",
		panel: true,
		pages: [
			{
				id: "traffic",
				to: "/monitoring/traffic",
				titleKey: "monitoring.tab.traffic",
				icon: "ChartLine",
				section: ADMIN,
				when: "monitoring",
			},
			{
				id: "crowdsec",
				to: "/monitoring/crowdsec",
				titleKey: "monitoring.tab.crowdsec",
				icon: "Shield",
				section: ADMIN,
				when: "monitoring",
			},
			{ id: "goaccess", href: "/goaccess", titleKey: "nav.goaccess", icon: "ChartColumn", when: "goaccess" },
			{ id: "audit-log", to: "/audit-log", titleKey: "auditlogs", icon: "History", section: ADMIN },
		],
	},
	{
		id: "admin",
		titleKey: "nav.admin",
		icon: "Settings",
		panel: true,
		pages: [
			{ id: "users", to: "/users", titleKey: "users", icon: "Users", section: ADMIN },
			...SETTINGS_SECTIONS.map(({ id, category, labelKey }) => ({
				id: `settings-${id}`,
				to: `/settings/${id}`,
				titleKey: labelKey,
				icon: SETTINGS_ICONS[id],
				section: ADMIN,
				help: settingsHelpDoc(id),
				category,
			})),
		],
	},
];

/**
 * Whether a user may see a page: the page's permission (view or manage) and the user's flag for it. Without the user
 * (still loading) only the pages that need neither show.
 *
 * @param   {Object} page
 * @param   {Object} [user]  the user of /api/users/me: roles, permissions, monitoring, goaccess
 * @returns {boolean}
 */
export const canSeePage = (page, user) =>
	(!page.section || hasPermission(page.section, VIEW, user?.permissions, user?.roles)) &&
	(!page.when || Boolean(user?.[page.when]));

/**
 * The groups and pages a user may see: each group with only its visible pages, groups without one left out
 *
 * @param   {Object} [user]
 * @param   {Object[]} [groups]
 * @returns {Object[]}
 */
export const visibleGroups = (user, groups = NAV_GROUPS) =>
	groups
		.map((group) => ({ ...group, pages: group.pages.filter((page) => canSeePage(page, user)) }))
		.filter((group) => group.pages.length > 0);

// trailing slashes of a route
const TRAILING_SLASHES = /\/+$/u;

/**
 * The group and page a route belongs to: the page whose route it is exactly (no page has child routes, so
 * /certificates/foo belongs to none); null for a route of no page (the not-found page)
 *
 * @param   {string}   pathname
 * @param   {Object[]} [groups]
 * @returns {{ group: Object, page: Object } | null}
 */
export function locate(pathname, groups = NAV_GROUPS) {
	const path = pathname.length > 1 ? pathname.replace(TRAILING_SLASHES, "") : pathname;
	for (const group of groups) {
		const page = group.pages.find((item) => item.to === path);
		if (page) return { group, page };
	}
	return null;
}

/**
 * The page a group's tab or crumb opens: its first page with an internal route, else its first page (an external
 * link such as GoAccess, with href and no to)
 *
 * @param   {Object} group
 * @returns {Object}
 */
export const firstPage = (group) => group.pages.find((page) => page.to) ?? group.pages[0];

/**
 * The breadcrumb trail of a route: the group, a Settings section's category, the page (titleKey each; to on the
 * group's crumb, its first page); an empty trail for a route of no page. A group with one page shows that page only.
 *
 * @param   {string}   pathname
 * @param   {Object[]} [groups]  the visible groups (visibleGroups), so the group's link is a page the user may see
 * @returns {Array<{ titleKey: string, to?: string }>}
 */
export function breadcrumbs(pathname, groups = NAV_GROUPS) {
	const found = locate(pathname, groups);
	if (!found) return [];
	const { group, page } = found;
	if (group.pages.length === 1) return [{ titleKey: page.titleKey }];
	const first = firstPage(group);
	const trail = [{ titleKey: group.titleKey, ...(first.to && { to: first.to }) }];
	if (page.category) {
		trail.push({ titleKey: SETTINGS_CATEGORIES.find(({ id }) => id === page.category).labelKey });
	}
	trail.push({ titleKey: page.titleKey });
	return trail;
}

/**
 * The pages of a group in sections: the Admin group's Settings sections under their category's title, the other
 * pages in one untitled section
 *
 * @param   {Object} group
 * @returns {Array<{ id: string, titleKey?: string, pages: Object[] }>}
 */
export function pageSections(group) {
	const sections = [{ id: "pages", pages: group.pages.filter((page) => !page.category) }];
	for (const category of SETTINGS_CATEGORIES) {
		const pages = group.pages.filter((page) => page.category === category.id);
		if (pages.length > 0) sections.push({ id: category.id, titleKey: category.labelKey, pages });
	}
	return sections.filter((section) => section.pages.length > 0);
}

/**
 * The help document of the page a route shows, or null (no page, or a page without one)
 *
 * @param   {string} pathname
 * @param   {Object[]} [groups]
 * @returns {string|null}
 */
export const helpDocOf = (pathname, groups = NAV_GROUPS) => locate(pathname, groups)?.page.help ?? null;

/**
 * A page's badge from the host report: its count, the hosts with a config error (a red mark) and, for the
 * certificates, those that expire soon or have expired (an amber mark); null without a badge or a report
 *
 * @param   {Object} page
 * @param   {Object} [report]  GET /api/reports/hosts
 * @returns {{ count: number, errors: number, expiring: number } | null}
 */
export function pageBadge(page, report) {
	if (!page.badge || !report || typeof report[page.badge] !== "number") return null;
	return {
		count: report[page.badge],
		errors: report.errors?.[page.badge] ?? 0,
		expiring:
			page.badge === "certificate" ? (report.certificatesExpiring ?? 0) + (report.certificatesExpired ?? 0) : 0,
	};
}

/**
 * The mark of a rail icon: "error" when a page of its group has hosts with config errors, "warning" when certificates
 * expire, else null
 *
 * @param   {Object} group
 * @param   {Object} [report]
 * @returns {"error"|"warning"|null}
 */
export function groupAlert(group, report) {
	const badges = group.pages.map((page) => pageBadge(page, report)).filter(Boolean);
	if (badges.some((badge) => badge.errors > 0)) return "error";
	if (badges.some((badge) => badge.expiring > 0)) return "warning";
	return null;
}

// the cookie shadcn's SidebarProvider keeps its state in (ui/sidebar.jsx): "true" open, "false" folded
const SIDEBAR_COOKIE = /(?:^|;\s*)sidebar_state=(?<state>true|false)(?:;|$)/u;

/**
 * Whether the sidebar starts open: the state the SidebarProvider stored in its cookie, open when there is none
 *
 * @param   {string} cookie  document.cookie
 * @returns {boolean}
 */
export const sidebarOpenFromCookie = (cookie) => SIDEBAR_COOKIE.exec(cookie ?? "")?.groups.state !== "false";
