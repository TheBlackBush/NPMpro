import assert from "node:assert/strict";
import { it } from "node:test";
import { isPaletteShortcut, paletteGroups } from "./CommandPalette.js";

const sections = [
	{ id: "default-site", labelKey: "settings.default-site" },
	{ id: "nginx", labelKey: "settings.nginx" },
	{ id: "users", labelKey: "users" },
	{ id: "audit-log", labelKey: "auditlogs" },
];
const admin = { roles: ["admin"], permissions: {}, monitoring: true };

it("an admin gets the pages and every Settings section, Users and Audit Log among them", () => {
	const [pages, settings] = paletteGroups(admin, sections);
	assert.equal(pages.id, "pages");
	assert.ok(!pages.items.some((i) => i.to === "/users"));
	assert.ok(!pages.items.some((i) => i.to === "/audit-log"));
	assert.deepEqual(
		settings.items.map((i) => i.to),
		["/settings/default-site", "/settings/nginx", "/settings/users", "/settings/audit-log"],
	);
});

const goaccessEntry = (user) => paletteGroups(user, sections)[0].items.find((i) => i.id === "goaccess");

it("GoAccess gets its own entry next to the Monitoring page", () => {
	const entry = goaccessEntry({ ...admin, monitoring: true, goaccess: true });
	assert.deepEqual([entry.to, entry.external], ["/goaccess", true]);
});

it("with monitoring off the Monitoring item is the way to GoAccess, so no second entry", () => {
	const items = paletteGroups({ ...admin, monitoring: false, goaccess: true }, sections)[0].items;
	assert.equal(goaccessEntry({ ...admin, monitoring: false, goaccess: true }), undefined);
	assert.equal(items.filter((i) => i.to === "/goaccess").length, 1);
	assert.equal(items.find((i) => i.to === "/goaccess").external, true);
});

it("no GoAccess entry when GoAccess is off", () => {
	assert.equal(goaccessEntry({ ...admin, goaccess: false }), undefined);
	assert.equal(goaccessEntry(admin), undefined);
});

it("a limited user gets no Settings group and no Users or Audit Log", () => {
	const groups = paletteGroups({ roles: [], permissions: { proxyHosts: "view" } }, sections);
	assert.deepEqual(
		groups.map((g) => g.id),
		["pages"],
	);
	assert.ok(!groups[0].items.some((i) => i.to === "/users"));
});

it("Ctrl+K and Cmd+K open the palette, plain K does not", () => {
	assert.equal(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false }), true);
	assert.equal(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true }), true);
	assert.equal(isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false }), false);
});

it("Ctrl+K works on a non-Latin layout, where the key is not a k", () => {
	assert.equal(isPaletteShortcut({ key: "л", code: "KeyK", ctrlKey: true, metaKey: false }), true);
});

it("an event without key and code (browser autofill) is not the shortcut and does not throw", () => {
	assert.equal(isPaletteShortcut({ key: undefined, code: undefined, ctrlKey: true }), false);
});

it("Ctrl+Shift+K and Ctrl+Alt+K are not the shortcut", () => {
	assert.equal(isPaletteShortcut({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), false);
	assert.equal(isPaletteShortcut({ key: "k", code: "KeyK", ctrlKey: true, altKey: true }), false);
});
