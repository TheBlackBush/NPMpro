import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	authHeader,
	capLevel,
	clampChanges,
	expiresOnOf,
	LEVELS,
	levelAllowed,
	newTokenValues,
	ownerCaps,
	permissionSummary,
	setAllLevels,
	TOKEN_PLACEHOLDER,
	tokenMarks,
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

it("permissionSummary: all Manage, all View Only, counts without the zero parts; tokenState", () => {
	assert.deepEqual(permissionSummary(all("manage")), [["all-manage"]]);
	assert.deepEqual(permissionSummary(all("view")), [["all-view"]]);
	assert.deepEqual(permissionSummary(all("hidden")), [["hidden", 6]]);
	assert.deepEqual(permissionSummary({ ...all("hidden"), certificates: "view", proxyHosts: "manage" }), [
		["manage", 1],
		["view", 1],
		["hidden", 4],
	]);
	assert.deepEqual(permissionSummary({ ...all("manage"), streams: "view" }), [
		["manage", 5],
		["view", 1],
	]);
	assert.deepEqual(permissionSummary(undefined), [["hidden", 6]]);
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

it("authHeader fills a token in, or the placeholder for a missing or odd one", () => {
	assert.equal(authHeader(), "Authorization: Bearer YOUR_TOKEN");
	assert.equal(authHeader("npmpro_ab12_Xy-z9"), "Authorization: Bearer npmpro_ab12_Xy-z9");
	assert.equal(authHeader('x" $(rm -rf ~)'), "Authorization: Bearer YOUR_TOKEN");
	assert.equal(authHeader(""), "Authorization: Bearer YOUR_TOKEN");
	assert.equal(authHeader(null), "Authorization: Bearer YOUR_TOKEN");
	assert.equal(authHeader(123), "Authorization: Bearer YOUR_TOKEN");
	assert.equal(TOKEN_PLACEHOLDER, "YOUR_TOKEN");
});

it("capLevel takes the lower level; unknown counts as hidden", () => {
	assert.equal(capLevel("manage", "view"), "view");
	assert.equal(capLevel("view", "manage"), "view");
	assert.equal(capLevel("hidden", "manage"), "hidden");
	assert.equal(capLevel("manage", undefined), "hidden");
	assert.equal(capLevel("nonsense", "manage"), "hidden");
});

// the six sections of all(), without its visibility key (setAllLevels returns the sections only)
const sections = (level) => {
	const { visibility: _visibility, ...rest } = all(level);
	return rest;
};

it("setAllLevels: every section at the chosen level, capped", () => {
	assert.deepEqual(setAllLevels("manage", all("manage")), sections("manage"));
	assert.deepEqual(setAllLevels("hidden", all("manage")), sections("hidden"));
	assert.deepEqual(setAllLevels("manage", all("view")), sections("view"));
	const caps = { ...all("manage"), streams: "hidden", certificates: "view" };
	assert.deepEqual(setAllLevels("manage", caps), { ...sections("manage"), streams: "hidden", certificates: "view" });
});

it("setAllLevels never goes above a cap to satisfy a dependency", () => {
	// proxy hosts need the access lists, but the owner has none: they stay hidden, like a single click does
	const caps = { ...all("manage"), accessLists: "hidden" };
	const values = setAllLevels("view", caps);
	assert.equal(values.proxyHosts, "view");
	assert.equal(values.accessLists, "hidden");
});

it("tokenMarks lists Administrator, Allow delete and Expired in that order", () => {
	assert.deepEqual(tokenMarks({ admin: true, allowDelete: true, expired: true }, NOW), [
		"admin",
		"allowDelete",
		"expired",
	]);
	assert.deepEqual(tokenMarks({ admin: false, allowDelete: false, expiresOn: null }, NOW), []);
	assert.deepEqual(tokenMarks({ allowDelete: true, expiresOn: "2026-11-16T00:00:00Z" }, NOW), [
		"allowDelete",
		"expired",
	]);
});

it("every mark, level and visibility the cells show has its translation", () => {
	for (const id of ["api-tokens.admin", "api-tokens.allow-delete", "api-tokens.expired"]) assert.ok(en[id], id);
	for (const level of LEVELS) assert.ok(en[`permissions.${level}`], level);
	for (const visibility of ["user", "all"]) assert.ok(en[`permissions.visibility.${visibility}`], visibility);
});
