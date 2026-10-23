import assert from "node:assert/strict";
import { it } from "node:test";
import {
	applyOidcUpdate,
	disablePasswordRefused,
	normalizeDomains,
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
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "password", false), true);
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "oidc", false), false);
	assert.equal(disablePasswordRefused({ disable_password: true }, [], "password", true), false);
	assert.equal(disablePasswordRefused({ disable_password: false }, [], "password", false), false);
	assert.equal(disablePasswordRefused({}, [], "password", false), false);
	assert.equal(disablePasswordRefused({ disable_password: true }, ["disable_password"], "password", false), false);
});
