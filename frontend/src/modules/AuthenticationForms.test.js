import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	AUTHENTICATION_RECHECKS,
	authenticationPayload,
	authenticationValidate,
	authenticationValues,
} from "./AuthenticationForms.js";
import { fieldPaths } from "./HookForm.js";
import { camel } from "./Oidc.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const lockedBy = (data) => {
	const locked = new Set((data.locked ?? []).map(camel));
	return (key) => locked.has(key);
};

const DATA = {
	enabled: true,
	active: true,
	issuerUrl: "https://id.example.com",
	clientId: "npmpro",
	clientSecretSet: true,
	secretError: false,
	redirectDomain: "npm.example.com",
	scopes: "openid email profile",
	requireVerifiedEmail: true,
	skipMfa: false,
	disablePassword: false,
	sessionAuthMethod: "password",
	autoCreate: {
		enabled: true,
		allowedDomains: ["example.com", "example.org"],
		permissions: { visibility: "all", proxyHosts: "manage" },
	},
	button: { label: "Sign in with ID", color: "#066fd1", icon: { type: "builtin", name: "key" } },
	locked: [],
};

it("starting values in the section's order: provider, button, sign-in rules, new users", () => {
	const values = authenticationValues(DATA);
	assert.deepEqual(fieldPaths(values), [
		"enabled",
		"issuerUrl",
		"clientId",
		"clientSecret",
		"redirectDomain",
		"scopes",
		"buttonLabel",
		"buttonColor",
		"buttonIcon",
		"requireVerifiedEmail",
		"skipMfa",
		"disablePassword",
		"autoCreateEnabled",
		"autoCreateDomains",
		"autoCreatePermissions.visibility",
		"autoCreatePermissions.proxyHosts",
		"autoCreatePermissions.redirectionHosts",
		"autoCreatePermissions.deadHosts",
		"autoCreatePermissions.streams",
		"autoCreatePermissions.accessLists",
		"autoCreatePermissions.certificates",
	]);
	assert.equal(values.autoCreateDomains, "example.com, example.org");
	assert.deepEqual(values.autoCreatePermissions, {
		visibility: "all",
		proxyHosts: "manage",
		redirectionHosts: "view",
		deadHosts: "view",
		streams: "view",
		accessLists: "view",
		certificates: "view",
	});
	const empty = authenticationValues({ enabled: false });
	assert.equal(empty.buttonColor, "#206bc4");
	assert.equal(empty.autoCreateEnabled, false);
	assert.equal(empty.autoCreatePermissions.visibility, "user");
});

it("the same errors as the Formik validate", () => {
	const validate = authenticationValidate(rules, DATA, lockedBy(DATA));
	const values = authenticationValues(DATA);
	assert.deepEqual(validate(values), {});
	assert.deepEqual(
		validate({
			...values,
			issuerUrl: "http://id.example.com",
			redirectDomain: "https://npm.example.com",
			scopes: "email",
			buttonLabel: " ",
			buttonColor: "#12345",
			autoCreateDomains: "example.com, nope",
		}),
		{
			issuerUrl: "Enter an https:// URL",
			// the issuer moved, so the saved secret must be entered again
			clientSecret: "Enter the client secret again when the issuer URL or client ID changes.",
			redirectDomain:
				"Enter only the domain and an optional port, without https:// or a path (for example npm.example.com)",
			scopes: "Enter scopes separated by spaces, including openid",
			buttonColor: "Use the format #rrggbb",
			buttonLabel: "Enter a display name",
			autoCreateDomains: "Not a valid domain: nope",
		},
	);
	assert.deepEqual(validate({ ...values, clientId: "c".repeat(256), clientSecret: "s".repeat(1025) }), {
		clientId: "Maximum length is 255 characters",
		clientSecret: "Maximum length is 1024 characters",
	});
	const many = Array.from({ length: 101 }, (_, i) => `d${i}.example.com`).join(",");
	assert.deepEqual(validate({ ...values, autoCreateDomains: many }), { autoCreateDomains: "At most 100 domains" });
});

it("asks for the secret again once the issuer or the client moves", () => {
	const validate = authenticationValidate(rules, DATA, lockedBy(DATA));
	const values = authenticationValues(DATA);
	assert.deepEqual(validate({ ...values, clientId: "other" }), {
		clientSecret: "Enter the client secret again when the issuer URL or client ID changes.",
	});
	assert.deepEqual(validate({ ...values, clientId: "other", clientSecret: "new" }), {});
	assert.deepEqual(validate({ ...values, clientId: " npmpro " }), {});
	const locked = { ...DATA, locked: ["client_id"] };
	assert.deepEqual(authenticationValidate(rules, locked, lockedBy(locked))({ ...values, clientId: "other" }), {});
});

it("refuses password login off from a password session once the connection is on and complete", () => {
	const data = { ...DATA, active: false };
	const validate = authenticationValidate(rules, data, lockedBy(data));
	const values = { ...authenticationValues(data), disablePassword: true };
	assert.deepEqual(validate(values), {
		disablePassword:
			"Password login can only be disabled while signed in with OIDC. Untick Disable password login to save these settings now.",
	});
	assert.deepEqual(validate({ ...values, enabled: false }), {});
	assert.deepEqual(validate({ ...values, redirectDomain: "" }), {});
	const oidcSession = { ...data, sessionAuthMethod: "oidc" };
	assert.deepEqual(authenticationValidate(rules, oidcSession, lockedBy(oidcSession))(values), {});
	const before = { ...DATA, disablePassword: true };
	assert.deepEqual(authenticationValidate(rules, before, lockedBy(before))(values), {});
});

it("checks the dependent messages again when a field they follow changes", () => {
	assert.deepEqual(AUTHENTICATION_RECHECKS.issuerUrl, ["clientSecret", "disablePassword"]);
	assert.deepEqual(AUTHENTICATION_RECHECKS.clientId, ["clientSecret", "disablePassword"]);
	for (const field of ["enabled", "clientSecret", "redirectDomain"]) {
		assert.deepEqual(AUTHENTICATION_RECHECKS[field], ["disablePassword"], field);
	}
});

it("sends the settings as before: the button, the new-user defaults, no empty secret", () => {
	const values = authenticationValues(DATA);
	const payload = authenticationPayload(
		{ ...values, buttonLabel: " Sign in ", autoCreateDomains: "A.com, a.com" },
		DATA,
	);
	assert.deepEqual(payload.button, {
		label: "Sign in",
		color: "#066fd1",
		icon: { type: "builtin", name: "key" },
	});
	assert.deepEqual(payload.autoCreate, {
		enabled: true,
		allowedDomains: ["a.com"],
		permissions: values.autoCreatePermissions,
	});
	assert.equal("clientSecret" in payload, false);
	assert.equal(payload.issuerUrl, "https://id.example.com");
	const picked = authenticationPayload({ ...values, buttonIcon: "lock", clientSecret: "s3cret" }, DATA);
	assert.deepEqual(picked.button.icon, { type: "builtin", name: "lock" });
	assert.equal(picked.clientSecret, "s3cret");
});
