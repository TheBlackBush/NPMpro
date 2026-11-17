import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	clampChanges,
	expiresOnOf,
	levelAllowed,
	newTokenValues,
	ownerCaps,
	permissionSummary,
	tokenPayload,
	tokenState,
	tomorrowOf,
} from "./ApiTokens.js";

const ANGLE_BRACKET = /[<>]/u;
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
	assert.equal(expiresOnOf("90", "", NOW), new Date(NOW.getTime() + 90 * 86_400_000).toISOString());
	assert.equal(expiresOnOf("365", "", NOW), new Date(NOW.getTime() + 365 * 86_400_000).toISOString());
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
	const bad = Object.entries(en).filter(
		([key, value]) =>
			(key.startsWith("api-tokens.") || key.startsWith("settings.api-access")) && ANGLE_BRACKET.test(value),
	);
	assert.deepEqual(bad, []);
});

it("ownerCaps: a non-admin with visibility all gets all, user or missing gets user", () => {
	assert.equal(ownerCaps({ roles: [], permissions: { visibility: "all" } }).visibility, "all");
	assert.equal(ownerCaps({ roles: [], permissions: { visibility: "user" } }).visibility, "user");
	assert.equal(ownerCaps({ roles: [], permissions: {} }).visibility, "user");
});

it("tomorrowOf: the next local day, across a month end", () => {
	assert.equal(tomorrowOf(new Date(2026, 10, 17, 23, 30)), "2026-11-18");
	assert.equal(tomorrowOf(new Date(2026, 11, 31, 8)), "2027-01-01");
});
