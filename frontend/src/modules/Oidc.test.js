import assert from "node:assert/strict";
import { it } from "node:test";
import { contrastText, oidcErrorKey, oidcSettingsPayload, readOidcError } from "./Oidc.js";

it("picks the text colour with the higher contrast", () => {
	assert.equal(contrastText("#ffffff"), "#000000");
	assert.equal(contrastText("#000000"), "#ffffff");
	assert.equal(contrastText("#206bc4"), "#ffffff");
	assert.equal(contrastText("#f2c94c"), "#000000");
});

it("maps error codes to message keys, unknown codes to provider_error", () => {
	assert.equal(oidcErrorKey("no_user"), "login.oidc-error.no_user");
	assert.equal(oidcErrorKey("whatever"), "login.oidc-error.provider_error");
});

it("reads the oidc_error parameter and returns the url without it", () => {
	assert.deepEqual(readOidcError("https://x/login?oidc_error=no_email&a=1"), {
		code: "no_email",
		url: "https://x/login?a=1",
	});
	assert.deepEqual(readOidcError("https://x/login"), { code: null, url: "https://x/login" });
});

it("keeps only the editable settings, drops locked keys and an empty secret", () => {
	const values = {
		enabled: true,
		issuerUrl: "https://id.example.com/",
		clientId: "npmpro",
		clientSecret: "",
		clientSecretSet: true,
		redirectDomain: "",
		scopes: "openid email",
		requireVerifiedEmail: true,
		skipMfa: false,
		disablePassword: false,
		autoCreate: { enabled: false },
		button: { label: "OIDC" },
		locked: ["issuerUrl", "clientId"],
		active: true,
		callbackUrl: "x",
	};
	const payload = oidcSettingsPayload(values);
	assert.deepEqual(Object.keys(payload).sort(), [
		"autoCreate",
		"button",
		"disablePassword",
		"enabled",
		"redirectDomain",
		"requireVerifiedEmail",
		"scopes",
		"skipMfa",
	]);
	assert.equal(oidcSettingsPayload({ ...values, clientSecret: "s3" }).clientSecret, "s3");
});
