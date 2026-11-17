import assert from "node:assert/strict";
import { it } from "node:test";
import { bearerOf, generateApiToken, hashSecret, parseApiToken, secretMatches } from "../lib/api-token.js";
import { aboveOwner, effectivePermissions, ownerLevels, SECTIONS, tokenIsAdmin } from "../lib/api-token-permissions.js";

const TOKEN = /^npmpro_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const levels = (level, visibility = "user") => ({ visibility, ...Object.fromEntries(SECTIONS.map((s) => [s, level])) });
const user = (permissions, roles = []) => ({ id: 7, roles, permissions });

it("generates a token in the npmpro_<lookup>_<secret> form whose hash matches only its own secret", () => {
	const made = generateApiToken();
	assert.match(made.token, TOKEN);
	const parsed = parseApiToken(made.token);
	assert.equal(parsed.lookupId, made.lookupId);
	assert.equal(made.secretHash, hashSecret(parsed.secret));
	assert.match(made.secretHash, HEX64);
	assert.equal(secretMatches(parsed.secret, made.secretHash), true);
	assert.equal(
		secretMatches(`${parsed.secret.slice(0, -1)}${parsed.secret.endsWith("A") ? "B" : "A"}`, made.secretHash),
		false,
	);
	assert.equal(secretMatches(parsed.secret, "abc"), false);
	assert.notEqual(generateApiToken().token, made.token);
});

it("parses only the exact token form", () => {
	for (const text of [
		null,
		undefined,
		"",
		"npmpro_",
		"npmpro_0123456789abcdef_short",
		`xx_0123456789abcdef_${"a".repeat(43)}`,
		`npmpro_0123456789ABCDEF_${"a".repeat(43)}`,
		`npmpro_0123456789abcdef_${"a".repeat(44)}`,
	]) {
		assert.equal(parseApiToken(text), null, String(text));
	}
	assert.deepEqual(parseApiToken(`npmpro_0000000000000000_${"a_-".repeat(14)}b`), {
		lookupId: "0000000000000000",
		secret: `${"a_-".repeat(14)}b`,
	});
});

it("reads a bearer from the Authorization header: null without one, the text (maybe empty) with one", () => {
	assert.equal(bearerOf(undefined), null);
	assert.equal(bearerOf("Basic dXNlcjpwYXNz"), null);
	assert.equal(bearerOf("Bearer abc"), "abc");
	assert.equal(bearerOf("bearer   abc  "), "abc");
	assert.equal(bearerOf("Bearer"), "");
	assert.equal(bearerOf("Bearer a b"), "");
});

it("owner levels: an administrator has manage everywhere and visibility all; a user without a row has nothing", () => {
	assert.deepEqual(ownerLevels(user(undefined, ["admin"])), levels("manage", "all"));
	assert.deepEqual(ownerLevels(user(undefined)), levels("hidden"));
	assert.deepEqual(ownerLevels(user({ ...levels("view", "all"), id: 3, user_id: 7 })), levels("view", "all"));
});

it("effective permissions are the lower level per section and visibility all only when both have it", () => {
	const owner = user({ ...levels("view", "user"), proxy_hosts: "manage" });
	const token = { ...levels("manage", "all"), certificates: "hidden" };
	assert.deepEqual(effectivePermissions(token, owner), {
		...levels("view", "user"),
		proxy_hosts: "manage",
		certificates: "hidden",
	});
	assert.equal(effectivePermissions(levels("view", "all"), user(levels("view", "all"))).visibility, "all");
	// an unknown stored level counts as hidden
	assert.equal(effectivePermissions({ ...levels("view"), streams: "root" }, owner).streams, "hidden");
});

it("administrator rights need both an admin owner and the switch", () => {
	assert.equal(tokenIsAdmin({ is_admin: true }, user(undefined, ["admin"])), true);
	assert.equal(tokenIsAdmin({ is_admin: false }, user(undefined, ["admin"])), false);
	assert.equal(tokenIsAdmin({ is_admin: true }, user(levels("manage", "all"))), false);
});

it("names what a requested token has above its owner", () => {
	const owner = user({ ...levels("view", "user") });
	assert.deepEqual(aboveOwner({ ...levels("view", "all"), streams: "manage" }, owner), ["visibility", "streams"]);
	assert.deepEqual(aboveOwner(levels("hidden"), owner), []);
	assert.deepEqual(aboveOwner(levels("manage", "all"), user(undefined, ["admin"])), []);
});
