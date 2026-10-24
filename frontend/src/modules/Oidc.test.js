import assert from "node:assert/strict";
import { it } from "node:test";
import {
	contrastText,
	isOidcColor,
	oidcErrorKey,
	oidcIconUrl,
	oidcSettingsPayload,
	readOidcError,
	shade,
	validOidcColor,
} from "./Oidc.js";

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

it("darkens a hex colour", () => {
	assert.equal(shade("#ffffff", 0.1), "#e6e6e6");
	assert.equal(shade("#000000", 0.5), "#000000");
	assert.equal(shade("#206bc4", 0), "#206bc4");
});

it("falls back to the default colour for invalid values", () => {
	assert.equal(validOidcColor("#AbCdEf"), "#AbCdEf");
	assert.equal(validOidcColor("red"), "#206bc4");
	assert.equal(validOidcColor(undefined), "#206bc4");
});

it("never sends a file icon in a save but keeps label and colour", () => {
	const file = { type: "file", ext: "png", updatedOn: "2026-10-24" };
	const withFile = oidcSettingsPayload({ button: { label: "SSO", color: "#112233", icon: file } });
	assert.deepEqual(withFile.button, { label: "SSO", color: "#112233" });
	const builtin = { type: "builtin", name: "lock" };
	assert.deepEqual(
		oidcSettingsPayload({ button: { label: "SSO", color: "#112233", icon: builtin } }).button.icon,
		builtin,
	);
});

it("validates hex colours and builds the icon url with a version", () => {
	assert.equal(isOidcColor("#a1B2c3"), true);
	assert.equal(isOidcColor("#abc"), false);
	assert.equal(isOidcColor("206bc4"), false);
	assert.equal(oidcIconUrl("2026-10-24T10:00:00Z"), "/api/oidc/icon?v=2026-10-24T10%3A00%3A00Z");
});
