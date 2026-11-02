import assert from "node:assert/strict";
import { it } from "node:test";
import { isPaletteShortcut, paletteGroups } from "./CommandPalette.js";

const sections = [
	{ id: "default-site", labelKey: "settings.default-site" },
	{ id: "nginx", labelKey: "settings.nginx" },
];
const admin = { roles: ["admin"], permissions: {}, monitoring: true };

it("an admin gets the pages, Users and Audit Log, and every Settings section", () => {
	const [pages, settings] = paletteGroups(admin, sections);
	assert.equal(pages.id, "pages");
	assert.ok(pages.items.some((i) => i.to === "/users"));
	assert.ok(pages.items.some((i) => i.to === "/audit-log"));
	assert.deepEqual(
		settings.items.map((i) => i.to),
		["/settings/default-site", "/settings/nginx"],
	);
});

it("GoAccess is in the palette whenever it is on, also next to Monitoring", () => {
	const [pages] = paletteGroups({ ...admin, goaccess: true }, sections);
	const goaccess = pages.items.find((i) => i.id === "goaccess");
	assert.deepEqual([goaccess.to, goaccess.external], ["/goaccess", true]);
	assert.ok(!paletteGroups(admin, sections)[0].items.some((i) => i.id === "goaccess"));
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
