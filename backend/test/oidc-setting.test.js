import assert from "node:assert/strict";
import { it } from "node:test";
import {
	applyOidcUpdate,
	disablePasswordRefused,
	normalizeDomains,
	passwordLoginDisabled,
	sanitizeOidcRow,
} from "../internal/oidc-setting-rules.js";

const encrypt = (s) => `enc(${s})`;

it("never exposes the secret", () => {
	const out = sanitizeOidcRow({ client_id: "x", client_secret: "v1:abc" });
	assert.equal(out.client_secret, undefined);
	assert.equal("client_secret" in out, false);
	assert.equal(out.client_secret_set, true);
	assert.equal(out.client_id, "x");
	assert.equal(sanitizeOidcRow({}).client_secret_set, false);
	assert.equal(sanitizeOidcRow(undefined).client_secret_set, false);
	assert.equal(sanitizeOidcRow({ client_secret: "" }).client_secret_set, false);
});

it("keeps the saved secret when the body secret is empty or omitted", () => {
	assert.equal(
		applyOidcUpdate({ client_secret: "v1:old" }, { client_secret: "" }, [], encrypt).client_secret,
		"v1:old",
	);
	assert.equal(applyOidcUpdate({ client_secret: "v1:old" }, {}, [], encrypt).client_secret, "v1:old");
	assert.equal(
		applyOidcUpdate({ client_secret: "v1:old" }, { client_secret: "new" }, [], encrypt).client_secret,
		"enc(new)",
	);
	assert.equal("client_secret" in applyOidcUpdate({}, { client_secret: "" }, [], encrypt), false);
});

it("ignores locked keys in the body", () => {
	const out = applyOidcUpdate(
		{ client_id: "stored" },
		{ client_id: "body", scopes: "openid" },
		["client_id"],
		encrypt,
	);
	assert.equal(out.client_id, "stored");
	assert.equal(out.scopes, "openid");
	const secret = applyOidcUpdate({ client_secret: "v1:old" }, { client_secret: "new" }, ["client_secret"], encrypt);
	assert.equal(secret.client_secret, "v1:old");
});

it("does not mutate the stored object", () => {
	const stored = { auto_create: { enabled: false, permissions: { streams: "view" } }, button: { label: "A" } };
	const copy = structuredClone(stored);
	applyOidcUpdate(
		stored,
		{ auto_create: { permissions: { streams: "manage" } }, button: { label: "B" } },
		[],
		encrypt,
	);
	assert.deepEqual(stored, copy);
});

it("deep merges auto_create permissions and button", () => {
	const stored = {
		auto_create: {
			enabled: true,
			allowed_domains: ["a.com"],
			permissions: { streams: "view", dead_hosts: "manage" },
		},
		button: { label: "Old", color: "#000000", icon: { type: "file", ext: "png", updated_on: 1 } },
	};
	const out = applyOidcUpdate(
		stored,
		{ auto_create: { permissions: { streams: "manage" } }, button: { label: "New" } },
		[],
		encrypt,
	);
	assert.deepEqual(out.auto_create, {
		enabled: true,
		allowed_domains: ["a.com"],
		permissions: { streams: "manage", dead_hosts: "manage" },
	});
	assert.deepEqual(out.button, { label: "New", color: "#000000", icon: { type: "file", ext: "png", updated_on: 1 } });
	const icon = applyOidcUpdate(stored, { button: { icon: { type: "builtin", name: "lock" } } }, [], encrypt);
	assert.deepEqual(icon.button.icon, { type: "builtin", name: "lock" });
});

it("normalises allowed domains", () => {
	assert.deepEqual(normalizeDomains([" Example.COM ", "", "example.com", "b.org", "  "]), ["example.com", "b.org"]);
	const out = applyOidcUpdate({}, { auto_create: { allowed_domains: ["A.com", "a.com "] } }, [], encrypt);
	assert.deepEqual(out.auto_create.allowed_domains, ["a.com"]);
});

it("refuses turning password login off only from a non-OIDC session", () => {
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "password", { current: false }), true);
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "oidc", { current: false }), false);
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "password", { current: true }), false);
	assert.equal(disablePasswordRefused({ disable_password: false }, [], "password", { current: false }), false);
	assert.equal(disablePasswordRefused({}, [], "password", { current: false }), false);
	assert.equal(
		disablePasswordRefused({ disable_password: true }, ["disable_password"], "password", { current: false }),
		false,
	);
});

const connection = {
	issuer_url: "https://idp.example.com",
	client_id: "npmpro",
	client_secret: "encrypted",
	redirect_domain: "npm.example.com",
};

it("computes whether password login is disabled in effect", () => {
	assert.equal(passwordLoginDisabled({ ...connection, enabled: true, disable_password: true }, {}), true);
	assert.equal(passwordLoginDisabled({ ...connection, enabled: false, disable_password: true }, {}), false);
	assert.equal(passwordLoginDisabled({ ...connection, enabled: true, disable_password: false }, {}), false);
	assert.equal(passwordLoginDisabled({ ...connection, enabled: true, disable_password: true }, {}, false), false);
	const { client_secret: _secret, ...noSecret } = connection;
	assert.equal(passwordLoginDisabled({ ...noSecret, enabled: true, disable_password: true }, {}), false);
	assert.equal(
		passwordLoginDisabled({ ...noSecret, disable_password: true }, { OIDC_CLIENT_SECRET: "s" }),
		false,
		"env secret alone does not activate a disabled row",
	);
	assert.equal(passwordLoginDisabled({ enabled: true }, { OIDC_DISABLE_PASSWORD: "true" }), false);
});

it("refuses a non-OIDC save that disables password login in effect", () => {
	const effective = { before: false, after: true };
	assert.equal(disablePasswordRefused({ enabled: true }, [], "password", { current: true, ...effective }), true);
	assert.equal(
		disablePasswordRefused({ redirect_domain: "a.example.com" }, [], "password", { current: true, ...effective }),
		true,
	);
	assert.equal(disablePasswordRefused({ enabled: true }, [], "oidc", { current: true, ...effective }), false);
	assert.equal(
		disablePasswordRefused({ enabled: true }, ["disable_password"], "password", { current: true, ...effective }),
		false,
	);
	assert.equal(
		disablePasswordRefused({ scopes: "openid" }, [], "password", { current: true, before: true, after: true }),
		false,
	);
	assert.equal(
		disablePasswordRefused({ enabled: true }, [], "password", { current: true, before: false, after: false }),
		false,
	);
	assert.equal(
		disablePasswordRefused({ enabled: false }, [], "password", { current: true, before: true, after: false }),
		false,
		"giving password login back is always allowed",
	);
});

it("a new issuer or client id needs the client secret again", () => {
	const stored = { issuer_url: "https://idp.example", client_id: "npmpro", client_secret: "v1:old" };
	const refused = { status: 400, message_i18n: "error.oidc-secret-required" };
	assert.throws(() => applyOidcUpdate(stored, { issuer_url: "https://attacker.example" }, [], encrypt), refused);
	assert.throws(() => applyOidcUpdate(stored, { client_id: "other", client_secret: "" }, [], encrypt), refused);
	const moved = applyOidcUpdate(stored, { issuer_url: "https://new.example", client_secret: "s" }, [], encrypt);
	assert.equal(moved.issuer_url, "https://new.example");
	assert.notEqual(moved.client_secret, "v1:old");
	// unchanged values, a secret set by env, or a locked issuer keep working
	assert.equal(
		applyOidcUpdate(stored, { issuer_url: "https://idp.example", enabled: true }, [], encrypt).client_secret,
		"v1:old",
	);
	assert.doesNotThrow(() => applyOidcUpdate(stored, { issuer_url: "https://x.example" }, ["client_secret"], encrypt));
	assert.doesNotThrow(() => applyOidcUpdate(stored, { issuer_url: "https://x.example" }, ["issuer_url"], encrypt));
	// first setup: nothing stored to protect
	assert.doesNotThrow(() => applyOidcUpdate({}, { issuer_url: "https://idp.example", client_id: "a" }, [], encrypt));
});
