import assert from "node:assert/strict";
import { it } from "node:test";
import {
	claimsErrorCode,
	newUserPermissions,
	OIDC_ERROR_CODES,
	OidcLoginError,
	oidcErrorCode,
	oidcErrorUrl,
} from "../lib/oidc-login.js";

const CERTIFICATES = /Certificates/u;

const VALID = {
	visibility: "user",
	proxy_hosts: "view",
	redirection_hosts: "view",
	dead_hosts: "view",
	streams: "view",
	access_lists: "view",
	certificates: "view",
};

it("error codes are the documented list", () => {
	assert.deepEqual(OIDC_ERROR_CODES, [
		"not_configured",
		"provider_error",
		"no_email",
		"email_not_verified",
		"no_user",
		"domain_not_allowed",
		"user_disabled",
	]);
});

it("OidcLoginError keeps known codes and maps unknown ones to provider_error", () => {
	assert.equal(new OidcLoginError("user_disabled").code, "user_disabled");
	assert.equal(new OidcLoginError("whatever").code, "provider_error");
	assert.equal(new OidcLoginError("no_user", "details").message, "details");
});

it("only OidcLoginError codes reach the URL, other errors become provider_error", () => {
	assert.equal(oidcErrorCode(new OidcLoginError("no_user")), "no_user");
	assert.equal(oidcErrorCode(new Error("token endpoint said no")), "provider_error");
	assert.equal(oidcErrorCode(undefined), "provider_error");
});

it("the login URL carries only known codes", () => {
	assert.equal(oidcErrorUrl("no_email"), "/login?oidc_error=no_email");
	assert.equal(oidcErrorUrl("<script>"), "/login?oidc_error=provider_error");
});

it("claims without an email are refused", () => {
	assert.equal(claimsErrorCode({}, { require_verified_email: false }), "no_email");
	assert.equal(claimsErrorCode({ email: "  " }, { require_verified_email: false }), "no_email");
	assert.equal(claimsErrorCode({ email: ["a@b.c"] }, { require_verified_email: false }), "no_email");
	assert.equal(claimsErrorCode(undefined, { require_verified_email: false }), "no_email");
});

it("the verified email rule needs email_verified to be exactly true", () => {
	const values = { require_verified_email: true };
	assert.equal(claimsErrorCode({ email: "a@b.c" }, values), "email_not_verified");
	assert.equal(claimsErrorCode({ email: "a@b.c", email_verified: "true" }, values), "email_not_verified");
	assert.equal(claimsErrorCode({ email: "a@b.c", email_verified: true }, values), null);
	assert.equal(claimsErrorCode({ email: "a@b.c" }, { require_verified_email: false }), null);
});

it("default permissions are copied when valid", () => {
	assert.deepEqual(newUserPermissions({ ...VALID, extra: "x" }), { permissions: VALID, error: null });
});

it("default permissions with unknown or missing values are refused", () => {
	assert.equal(newUserPermissions({ ...VALID, visibility: "admin" }).permissions, null);
	assert.equal(newUserPermissions({ ...VALID, streams: undefined }).permissions, null);
	assert.equal(newUserPermissions(undefined).permissions, null);
});

it("default permissions that break the business rules are refused", () => {
	const result = newUserPermissions({ ...VALID, certificates: "hidden" });
	assert.equal(result.permissions, null);
	assert.match(result.error, CERTIFICATES);
});
