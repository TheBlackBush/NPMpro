import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { itemsOf, matchScore, PALETTE_TYPES, pageItems, paletteFilter, paletteTypes } from "./CommandPalette.js";
import { NAV_GROUPS, visibleGroups } from "./Navigation.js";

const typeOf = (id) => PALETTE_TYPES.find((type) => type.id === id);
const admin = { roles: ["admin"], permissions: {}, monitoring: true, goaccess: true };
const viewer = { roles: [], permissions: { proxyHosts: "view", certificates: "view" } };

it("offers only the item types whose page the user may see", () => {
	assert.deepEqual(
		paletteTypes(visibleGroups(admin)).map((type) => type.id),
		["proxy-hosts", "redirection-hosts", "dead-hosts", "streams", "certificates", "access-lists", "users"],
	);
	assert.deepEqual(
		paletteTypes(visibleGroups(viewer)).map((type) => type.id),
		["proxy-hosts", "certificates"],
	);
	assert.deepEqual(paletteTypes(visibleGroups(undefined)), []);
});

it("names every type's page, list function, window and heading correctly", () => {
	const pages = new Set(NAV_GROUPS.flatMap((group) => group.pages.map((page) => page.id)));
	const api = readFileSync(new URL("../api/backend/index.js", import.meta.url), "utf8");
	const modals = readdirSync(new URL("../modals/", import.meta.url))
		.filter((name) => name.endsWith(".jsx"))
		.map((name) => readFileSync(new URL(`../modals/${name}`, import.meta.url), "utf8"))
		.join("\n");
	for (const type of PALETTE_TYPES) {
		assert.ok(pages.has(type.pageId), type.id);
		assert.ok(en[type.titleKey], type.titleKey);
		assert.ok(api.includes(`"./${type.fetch}"`), type.fetch);
	}
	for (const { open } of PALETTE_TYPES.filter((type) => type.open.modal)) {
		assert.ok(modals.includes(`const ${open.modal} = (`), open.modal);
	}
});

it("turns rows into items found by domain, port, name and email", () => {
	const proxy = itemsOf(typeOf("proxy-hosts"), [
		{
			id: 7,
			domainNames: ["a.example.com", "b.example.com"],
			forwardScheme: "http",
			forwardHost: "10.0.0.2",
			forwardPort: 8080,
		},
	]);
	assert.deepEqual(
		proxy.map(({ value, id, label, detail }) => ({ value, id, label, detail })),
		[{ value: "proxy-hosts:7", id: 7, label: "a.example.com, b.example.com", detail: "http://10.0.0.2:8080" }],
	);
	const stream = itemsOf(typeOf("streams"), [
		{ id: 3, incomingPort: 2222, forwardingHost: "10.0.0.5", forwardingPort: 22 },
	]);
	assert.deepEqual(stream[0].keywords, ["2222", "10.0.0.5:22"]);
	const certificate = itemsOf(typeOf("certificates"), [
		{ id: 1, niceName: "Wildcard", domainNames: ["*.example.com"] },
		{ id: 2, niceName: "", domainNames: ["c.example.com"] },
	]);
	assert.deepEqual(
		certificate.map(({ label, detail }) => [label, detail]),
		[
			["Wildcard", "*.example.com"],
			["c.example.com", ""],
		],
	);
	assert.equal(typeOf("certificates").open.route(certificate[0].row), "/certificates?q=Wildcard");
	assert.equal(typeOf("certificates").open.route(certificate[1].row), "/certificates?q=c.example.com");
	const user = itemsOf(typeOf("users"), [{ id: 2, name: "Viewer", email: "viewer@example.com" }]);
	assert.deepEqual(user[0].keywords, ["Viewer", "viewer@example.com"]);
	assert.deepEqual(itemsOf(typeOf("users"), undefined), []);
});

it("shows a destination as the list pages do: path, empty, a path in the host, $scheme and no port", () => {
	const destination = (type, row) => itemsOf(typeOf(type), [{ id: 1, ...row }])[0].detail;
	const proxy = { domainNames: ["a.example.com"], forwardScheme: "http", forwardPort: 8080 };
	assert.equal(destination("proxy-hosts", { ...proxy, forwardHost: "10.0.0.2" }), "http://10.0.0.2:8080");
	assert.equal(destination("proxy-hosts", { ...proxy, forwardHost: "10.0.0.2/app" }), "http://10.0.0.2:8080/app");
	assert.equal(destination("proxy-hosts", { ...proxy, forwardScheme: "path", forwardHost: "/srv/www" }), "/srv/www");
	assert.equal(destination("proxy-hosts", { ...proxy, forwardScheme: "empty", forwardHost: "10.0.0.2" }), "");
	assert.equal(destination("proxy-hosts", { ...proxy, forwardHost: undefined }), "");
	const redirection = { domainNames: ["a.example.com"], forwardDomainName: "b.example.com" };
	assert.equal(destination("redirection-hosts", { ...redirection, forwardScheme: "$scheme" }), "b.example.com");
	assert.equal(destination("redirection-hosts", { ...redirection, forwardScheme: "https" }), "https://b.example.com");
	const stream = { incomingPort: 2222, forwardingHost: "10.0.0.5" };
	assert.equal(destination("streams", { ...stream, forwardingPort: undefined }), "10.0.0.5");
	assert.equal(destination("streams", { ...stream, forwardingPort: 22 }), "10.0.0.5:22");
	assert.deepEqual(itemsOf(typeOf("streams"), [{ id: 4, ...stream }])[0].keywords, ["2222", "10.0.0.5"]);
});

it("lists every visible page with its group", () => {
	const items = pageItems(visibleGroups(viewer));
	assert.deepEqual(
		items.map(({ value, group }) => [value, group.id]),
		[
			["page:dashboard", "overview"],
			["page:proxy-hosts", "hosts"],
			["page:certificates", "security"],
			["page:dns-credentials", "security"],
		],
	);
});

it("matches every word of the search, best at the start, without case or accents", () => {
	assert.equal(matchScore(["Proxy Hosts"], ""), 1);
	assert.equal(matchScore(["Proxy Hosts"], "prox"), 1);
	assert.equal(matchScore(["Proxy Hosts"], "PROXY hosts"), 1);
	assert.equal(matchScore(["www.example.com"], "example"), 0.75);
	assert.equal(matchScore(["Proxy Hosts"], "osts"), 0.5);
	assert.equal(matchScore(["Proxy Hosts"], "proxy nope"), 0);
	assert.equal(matchScore(["Zoë"], "zoe"), 1);
	assert.equal(matchScore(["Viewer", "viewer@example.com"], "example"), 0.75);
	assert.equal(matchScore(["2222", "10.0.0.5:22"], "10.0"), 1);
	assert.ok(matchScore(["Proxy Hosts"], "proxy") > matchScore(["Redirection Hosts"], "hosts proxy"));
	assert.equal(paletteFilter("page:x", "dns", ["DNS credentials", "Security"]), 1);
	assert.equal(paletteFilter("dns", "dns", undefined), 1);
});
