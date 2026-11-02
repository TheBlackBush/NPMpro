import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	breadcrumbs,
	canSeePage,
	firstPage,
	groupAlert,
	helpDocOf,
	locate,
	NAV_GROUPS,
	pageBadge,
	pageSections,
	sidebarOpenFromCookie,
	visibleGroups,
} from "./Navigation.js";
import { SETTINGS_SECTIONS } from "./SettingsSections.js";

// a route of Router.jsx: <Route path="...">
const ROUTE = /<Route path="(?<path>\/[^"*:]*)" element=\{<(?<element>[A-Za-z]+)/gu;

const admin = { roles: ["admin"], permissions: {}, monitoring: true, goaccess: true };
const viewer = {
	roles: [],
	permissions: { proxyHosts: "view", certificates: "manage", accessLists: "hidden", streams: "hidden" },
	monitoring: true,
	goaccess: false,
};
const idsOf = (groups) => groups.map((group) => [group.id, group.pages.map((page) => page.id)]);
const allPages = NAV_GROUPS.flatMap((group) => group.pages);

it("shows an administrator every group and page, in the menu's order", () => {
	assert.deepEqual(idsOf(visibleGroups(admin)), [
		["overview", ["dashboard"]],
		["hosts", ["proxy-hosts", "redirection-hosts", "dead-hosts", "streams"]],
		["security", ["certificates", "dns-credentials", "access-lists"]],
		["monitoring", ["traffic", "crowdsec", "goaccess", "audit-log"]],
		["admin", ["users", ...SETTINGS_SECTIONS.map(({ id }) => `settings-${id}`)]],
	]);
});

it("shows a user only the pages their permissions allow, and no group left empty", () => {
	assert.deepEqual(idsOf(visibleGroups(viewer)), [
		["overview", ["dashboard"]],
		["hosts", ["proxy-hosts"]],
		["security", ["certificates", "dns-credentials"]],
	]);
	// while the user loads, only the dashboard
	assert.deepEqual(idsOf(visibleGroups(undefined)), [["overview", ["dashboard"]]]);
});

it("hides Traffic and CrowdSec while monitoring is off, GoAccess while it is off", () => {
	const off = { ...admin, monitoring: false, goaccess: false };
	assert.deepEqual(
		idsOf(visibleGroups(off)).find(([id]) => id === "monitoring"),
		["monitoring", ["audit-log"]],
	);
	const goaccessPage = allPages.find((page) => page.id === "goaccess");
	assert.equal(canSeePage(goaccessPage, admin), true);
	assert.equal(canSeePage(goaccessPage, { ...admin, goaccess: false }), false);
});

it("finds the group and page of a route: an exact route, Settings belongs to Admin", () => {
	const at = (path) => {
		const found = locate(path);
		return found && [found.group.id, found.page.id];
	};
	assert.deepEqual(at("/"), ["overview", "dashboard"]);
	assert.deepEqual(at("/nginx/proxy"), ["hosts", "proxy-hosts"]);
	assert.deepEqual(at("/nginx/proxy/"), ["hosts", "proxy-hosts"]);
	assert.deepEqual(at("/certificates"), ["security", "certificates"]);
	assert.deepEqual(at("/certificates/dns-credentials"), ["security", "dns-credentials"]);
	assert.deepEqual(at("/settings/nginx"), ["admin", "settings-nginx"]);
	assert.deepEqual(at("/monitoring/crowdsec"), ["monitoring", "crowdsec"]);
	assert.deepEqual(at("/users"), ["admin", "users"]);
	// no page has child routes: a route below a page belongs to none (the not-found page)
	assert.equal(at("/certificates/foo"), null);
	assert.equal(at("/users/x"), null);
	assert.equal(at("/nginx/proxy/1"), null);
	// not a page: nothing is active
	assert.equal(at("/nope"), null);
	assert.equal(at("/settings/unknown"), null);
	assert.equal(at("/nginx/proxyx"), null);
});

it("builds the breadcrumbs: group, a Settings section's category, page", () => {
	assert.deepEqual(breadcrumbs("/"), [{ titleKey: "dashboard" }]);
	assert.deepEqual(breadcrumbs("/nginx/404"), [
		{ titleKey: "hosts", to: "/nginx/proxy" },
		{ titleKey: "dead-hosts" },
	]);
	assert.deepEqual(breadcrumbs("/settings/backup"), [
		{ titleKey: "nav.admin", to: "/users" },
		{ titleKey: "settings.category.data" },
		{ titleKey: "settings.backup" },
	]);
	assert.deepEqual(breadcrumbs("/nope"), []);
	// the group's link is the first page the user may see
	assert.deepEqual(breadcrumbs("/certificates/dns-credentials", visibleGroups(viewer))[0], {
		titleKey: "nav.security",
		to: "/certificates",
	});
	// a group shown with one page: that page alone
	assert.deepEqual(breadcrumbs("/nginx/proxy", visibleGroups(viewer)), [{ titleKey: "proxy-hosts" }]);
});

it("lists the Admin group's Settings sections under their categories", () => {
	const sections = pageSections(visibleGroups(admin).find((group) => group.id === "admin"));
	assert.deepEqual(
		sections.map(({ id, titleKey, pages }) => [id, titleKey, pages.length]),
		[
			["pages", undefined, 1],
			["sites", "settings.category.sites", 3],
			["security", "settings.category.security", 3],
			["monitoring", "settings.category.monitoring", 2],
			["data", "settings.category.data", 2],
			["system", "settings.category.system", 2],
		],
	);
	assert.deepEqual(
		pageSections(NAV_GROUPS[1]).map(({ id, pages }) => [id, pages.length]),
		[["pages", 4]],
	);
});

it("gives each page its help document, and every help document exists", () => {
	assert.equal(helpDocOf("/nginx/proxy"), "ProxyHosts");
	assert.equal(helpDocOf("/settings/forward-auth"), "SettingsForwardAuth");
	assert.equal(helpDocOf("/certificates/dns-credentials"), null);
	assert.equal(helpDocOf("/nope"), null);
	const missing = allPages
		.filter((page) => page.help)
		.map((page) => `en/${page.help}.md`)
		.filter((path) => !existsSync(new URL(`../../translations/help/${path}`, import.meta.url)));
	assert.deepEqual(missing, []);
});

it("covers every route of Router.jsx with a page, and every page's title has a text", () => {
	const source = readFileSync(new URL("../Router.jsx", import.meta.url), "utf8");
	const routes = [...source.matchAll(ROUTE)]
		.filter(({ groups }) => groups.element !== "Navigate")
		.map(({ groups }) => groups.path);
	assert.ok(routes.length >= 10);
	assert.deepEqual(
		routes.filter((path) => !locate(path) && !path.includes(":")),
		[],
	);
	for (const id of SETTINGS_SECTIONS.map((section) => section.id)) assert.ok(locate(`/settings/${id}`));
	const untitled = [...NAV_GROUPS, ...allPages].map((item) => item.titleKey).filter((key) => !en[key]);
	assert.deepEqual(untitled, []);
	assert.equal(new Set(allPages.map((page) => page.id)).size, allPages.length);
});

it("does not throw for a group whose first visible page is an external link", () => {
	const group = {
		id: "ext",
		titleKey: "monitoring",
		panel: true,
		pages: [
			{ id: "goaccess", href: "/goaccess", titleKey: "nav.goaccess" },
			{ id: "dashboard", to: "/", titleKey: "dashboard" },
		],
	};
	assert.equal(firstPage(group).id, "dashboard");
	const onlyExternal = { ...group, pages: [group.pages[0]] };
	assert.equal(firstPage(onlyExternal).href, "/goaccess");
	assert.equal(locate("/goaccess", [onlyExternal]), null);
	assert.deepEqual(
		breadcrumbs("/", [{ ...group, pages: [group.pages[0], { ...group.pages[1], id: "b" }, group.pages[1]] }]),
		[{ titleKey: "monitoring", to: "/" }, { titleKey: "dashboard" }],
	);
});

it("reads a page's badge and a group's mark from the host report", () => {
	const report = {
		proxy: 4,
		redirection: 1,
		dead: 0,
		stream: 2,
		certificate: 3,
		accessList: 1,
		errors: { proxy: 1, redirection: 0, dead: 0, stream: 0 },
		certificatesExpiring: 1,
		certificatesExpired: 1,
	};
	const page = (id) => allPages.find((item) => item.id === id);
	assert.deepEqual(pageBadge(page("proxy-hosts"), report), { count: 4, errors: 1, expiring: 0 });
	assert.deepEqual(pageBadge(page("certificates"), report), { count: 3, errors: 0, expiring: 2 });
	assert.deepEqual(pageBadge(page("access-lists"), report), { count: 1, errors: 0, expiring: 0 });
	assert.equal(pageBadge(page("dns-credentials"), report), null);
	// no report (loading or failed): no badge
	assert.equal(pageBadge(page("proxy-hosts"), undefined), null);
	const group = (id) => NAV_GROUPS.find((item) => item.id === id);
	assert.equal(groupAlert(group("hosts"), report), "error");
	assert.equal(groupAlert(group("security"), report), "warning");
	assert.equal(groupAlert(group("security"), { ...report, certificatesExpiring: 0, certificatesExpired: 0 }), null);
	assert.equal(groupAlert(group("admin"), report), null);
	assert.equal(groupAlert(group("hosts"), undefined), null);
});

it("starts the sidebar open unless its cookie says folded", () => {
	assert.equal(sidebarOpenFromCookie(""), true);
	assert.equal(sidebarOpenFromCookie(undefined), true);
	assert.equal(sidebarOpenFromCookie("sidebar_state=false"), false);
	assert.equal(sidebarOpenFromCookie("a=1; sidebar_state=false; b=2"), false);
	assert.equal(sidebarOpenFromCookie("a=1; sidebar_state=true"), true);
	assert.equal(sidebarOpenFromCookie("other_sidebar_state=false"), true);
});
