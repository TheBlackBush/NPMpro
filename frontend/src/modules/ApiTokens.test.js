import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import {
	clampChanges,
	expiresOnOf,
	levelAllowed,
	newTokenValues,
	ownerCaps,
	permissionSummary,
	tokenPayload,
	tokenState,
} from "./ApiTokens.js";

const NOW = new Date("2026-11-17T10:00:00Z");
const all = (level, visibility = "user") => ({
	visibility,
	proxyHosts: level,
	redirectionHosts: level,
	deadHosts: level,
	streams: level,
	accessLists: level,
	certificates: level,
});

it("ownerCaps: an admin has everything, a user its own levels, a missing row nothing", () => {
	assert.deepEqual(ownerCaps({ roles: ["admin"] }), all("manage", "all"));
	assert.deepEqual(ownerCaps({ roles: [], permissions: { ...all("view"), streams: "manage" } }), {
		...all("view"),
		streams: "manage",
	});
	assert.deepEqual(ownerCaps({ roles: [] }), all("hidden"));
});

it("levelAllowed compares hidden < view < manage", () => {
	assert.equal(levelAllowed("view", "manage"), true);
	assert.equal(levelAllowed("manage", "view"), false);
	assert.equal(levelAllowed("hidden", "hidden"), true);
});

it("clampChanges drops dependency changes above the cap", () => {
	assert.deepEqual(
		clampChanges({ accessLists: "view", certificates: "view" }, { ...all("view"), certificates: "hidden" }),
		{
			accessLists: "view",
		},
	);
});

it("expiresOnOf: days, a date (end of that day), never", () => {
	assert.equal(expiresOnOf("30", "", NOW), new Date(NOW.getTime() + 30 * 86_400_000).toISOString());
	assert.equal(expiresOnOf("never", "", NOW), null);
	const date = new Date(expiresOnOf("date", "2027-01-31", NOW));
	assert.equal(date.getFullYear(), 2027);
	assert.equal(date.getMonth(), 0);
	assert.equal(date.getDate(), 31);
	assert.equal(date.getHours(), 23);
});

it("tokenPayload trims the name and carries every section", () => {
	const values = { ...newTokenValues(all("manage", "all")), name: "  ci ", proxyHosts: "view" };
	const payload = tokenPayload(values, NOW);
	assert.equal(payload.name, "ci");
	assert.equal(payload.permissions.proxyHosts, "view");
	assert.equal(Object.keys(payload.permissions).length, 6);
	assert.equal(payload.admin, false);
	assert.equal(payload.allowDelete, false);
});

it("permissionSummary lists the shown sections in order; tokenState", () => {
	assert.deepEqual(
		permissionSummary({ permissions: { ...all("hidden"), certificates: "view", proxyHosts: "manage" } }),
		[
			["proxyHosts", "manage"],
			["certificates", "view"],
		],
	);
	assert.equal(tokenState({ expired: true }, NOW), "expired");
	assert.equal(tokenState({ expired: false, expiresOn: "2026-11-17T09:59:00Z" }, NOW), "expired");
	assert.equal(tokenState({ expired: false, expiresOn: null }, NOW), "active");
});

it("no API token message has angle brackets (react-intl reads them as tags)", () => {
	const en = JSON.parse(readFileSync(new URL("../../translations/ui/en.json", import.meta.url), "utf8"));
	const bad = Object.entries(en).filter(
		([key, value]) =>
			(key.startsWith("api-tokens.") || key.startsWith("settings.api-access")) && /[<>]/u.test(value),
	);
	assert.deepEqual(bad, []);
});
