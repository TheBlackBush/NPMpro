import assert from "node:assert/strict";
import { it } from "node:test";
import {
	callbackUrl,
	emailDomainAllowed,
	mergeOidcConfig,
	OIDC_DEFAULTS,
	userNameFromClaims,
	validateDefaultPermissions,
} from "../lib/oidc-rules.js";

const ACCESS_LISTS = /Access lists/u;
const CERTIFICATES = /Certificates/u;

const connection = {
	issuer_url: "https://id.example.com",
	client_id: "npm",
	client_secret: "s",
	redirect_domain: "npm.example.com",
};

it("defaults apply when nothing is stored or set", () => {
	const { values, locked, active } = mergeOidcConfig({}, {});
	assert.deepEqual(values, OIDC_DEFAULTS);
	assert.deepEqual(locked, []);
	assert.equal(active, false);
});

it("stored values are active only when enabled and complete", () => {
	assert.equal(mergeOidcConfig({ ...connection, enabled: false }, {}).active, false);
	assert.equal(mergeOidcConfig({ ...connection, enabled: true }, {}).active, true);
	assert.equal(mergeOidcConfig({ ...connection, client_secret: undefined, enabled: true }, {}).active, false);
});

it("env-only install is active without a stored row", () => {
	const env = {
		OIDC_ISSUER_URL: "https://id.example.com",
		OIDC_CLIENT_ID: "npm",
		OIDC_CLIENT_SECRET: "s",
		OIDC_REDIRECT_DOMAIN: "npm.example.com",
	};
	const { values, locked, active } = mergeOidcConfig({}, env);
	assert.equal(active, true);
	assert.equal(values.issuer_url, "https://id.example.com");
	assert.deepEqual(locked.sort(), ["client_id", "client_secret", "issuer_url", "redirect_domain"]);
});

it("env wins per field and booleans parse from strings", () => {
	const { values, locked } = mergeOidcConfig(
		{ ...connection, enabled: true, skip_mfa: true, disable_password: true },
		{ OIDC_CLIENT_ID: "from-env", OIDC_SKIP_MFA: "false", OIDC_DISABLE_PASSWORD: "false" },
	);
	assert.equal(values.client_id, "from-env");
	assert.equal(values.skip_mfa, false);
	assert.equal(values.disable_password, false);
	assert.deepEqual(locked.sort(), ["client_id", "disable_password", "skip_mfa"]);
});

it("empty env strings do not lock", () => {
	assert.deepEqual(mergeOidcConfig({}, { OIDC_CLIENT_ID: "" }).locked, []);
});

it("builds the callback url", () => {
	assert.equal(callbackUrl("npm.example.com:8443"), "https://npm.example.com:8443/api/oidc/callback");
});

it("matches email domains case-insensitively and exactly", () => {
	assert.equal(emailDomainAllowed("a@Example.com", ["example.com"]), true);
	assert.equal(emailDomainAllowed("a@sub.example.com", ["example.com"]), false);
	assert.equal(emailDomainAllowed("a@evil-example.com", ["example.com"]), false);
	assert.equal(emailDomainAllowed("a@anything.org", []), true);
	assert.equal(emailDomainAllowed("not-an-email", []), false);
});

it("refuses default permissions that break the permission rules", () => {
	const base = {
		visibility: "user",
		proxy_hosts: "view",
		redirection_hosts: "view",
		dead_hosts: "view",
		streams: "view",
		access_lists: "view",
		certificates: "view",
	};
	assert.equal(validateDefaultPermissions(base), null);
	assert.match(validateDefaultPermissions({ ...base, access_lists: "hidden" }), ACCESS_LISTS);
	assert.match(validateDefaultPermissions({ ...base, certificates: "hidden" }), CERTIFICATES);
});

it("derives a user name from claims", () => {
	assert.equal(userNameFromClaims({ name: "Ada L", email: "ada@example.com" }), "Ada L");
	assert.equal(userNameFromClaims({ preferred_username: "ada", email: "ada@example.com" }), "ada");
	assert.equal(userNameFromClaims({ email: "ada.l@example.com" }), "ada.l");
});

it("partial stored permissions and button keep the other defaults", () => {
	const { values } = mergeOidcConfig(
		{ auto_create: { permissions: { streams: "manage" } }, button: { label: "SSO" } },
		{},
	);
	assert.deepEqual(values.auto_create.permissions, { ...OIDC_DEFAULTS.auto_create.permissions, streams: "manage" });
	assert.equal(values.button.label, "SSO");
	assert.equal(values.button.color, OIDC_DEFAULTS.button.color);
	assert.deepEqual(values.button.icon, OIDC_DEFAULTS.button.icon);
});

it("stored null values are treated as absent", () => {
	const { values } = mergeOidcConfig({ require_verified_email: null, skip_mfa: null, button: null }, {});
	assert.equal(values.require_verified_email, true);
	assert.equal(values.skip_mfa, false);
	assert.deepEqual(values.button, OIDC_DEFAULTS.button);
});

it("require_verified_email from env fails closed", () => {
	assert.equal(mergeOidcConfig({}, { OIDC_REQUIRE_VERIFIED_EMAIL: "false" }).values.require_verified_email, false);
	assert.equal(mergeOidcConfig({}, { OIDC_REQUIRE_VERIFIED_EMAIL: "bogus" }).values.require_verified_email, true);
	assert.equal(mergeOidcConfig({}, { OIDC_SKIP_MFA: "bogus" }).values.skip_mfa, false);
});

it("rejects empty domains and ignores bad allow-list entries", () => {
	assert.equal(emailDomainAllowed("a@", [""]), false);
	assert.equal(emailDomainAllowed("a@", []), false);
	assert.equal(emailDomainAllowed("a@example.com", [" Example.com ", null, ""]), true);
	assert.equal(emailDomainAllowed("a@other.com", [null, ""]), false);
});
