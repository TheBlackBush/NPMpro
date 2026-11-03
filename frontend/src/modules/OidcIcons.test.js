import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { OIDC_ICONS, OIDC_PICKER_ICONS, oidcIcon } from "./OidcIcons.js";

const SAVED_BEFORE = [
	"key",
	"lock",
	"login",
	"shield-lock",
	"user-circle",
	"brand-google",
	"brand-github",
	"brand-gitlab",
	"brand-windows",
	"cloud",
];

it("every name saved before still resolves to its own entry", () => {
	for (const name of SAVED_BEFORE) assert.equal(oidcIcon(name).name, name, name);
});

it("an unknown name falls back to the login icon", () => {
	assert.equal(oidcIcon("brand-unknown").name, "login");
	assert.equal(oidcIcon(undefined).name, "login");
});

it("Windows is kept for saved settings but not offered in the picker", () => {
	assert.equal(oidcIcon("brand-windows").kind, "generic");
	assert.ok(!OIDC_PICKER_ICONS.some((entry) => entry.name === "brand-windows"));
});

it("brand entries carry a Simple Icons path and colour; names are unique", () => {
	for (const entry of OIDC_ICONS.filter((e) => e.kind === "brand")) {
		assert.match(entry.icon.path, /^[Mm]/u, entry.name);
		assert.match(entry.icon.hex, /^[0-9A-F]{6}$/u, entry.name);
	}
	assert.equal(new Set(OIDC_ICONS.map((e) => e.name)).size, OIDC_ICONS.length);
	assert.ok(OIDC_PICKER_ICONS.some((e) => e.name === "brand-authentik"));
	assert.ok(OIDC_PICKER_ICONS.some((e) => e.name === "brand-authelia"));
});

// the built-in icon name enum of a backend schema file (the oneOf branch whose type is "builtin")
const schemaNames = (path) => {
	const found = [];
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (node.properties?.type?.enum?.[0] === "builtin" && node.properties?.name?.enum) {
			found.push(node.properties.name.enum);
		}
		for (const value of Object.values(node)) walk(value);
	};
	walk(JSON.parse(readFileSync(new URL(`../../../backend/schema/${path}`, import.meta.url), "utf8")));
	assert.equal(found.length, 1, path);
	return found[0];
};

it("the backend schemas accept exactly the built-in icon names", () => {
	const names = new Set(OIDC_ICONS.map((entry) => entry.name));
	assert.ok(names.has("brand-windows"));
	for (const path of ["components/oidc-setting-object.json", "paths/settings/oidc/put.json"]) {
		const accepted = schemaNames(path);
		assert.equal(new Set(accepted).size, accepted.length, path);
		assert.deepEqual(new Set(accepted), names, path);
	}
});
