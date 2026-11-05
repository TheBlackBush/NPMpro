import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { PASSWORD, startApi } from "./support/api.js";
import { setCookie } from "./support/auth.js";

let api;

before(async () => {
	// OIDC set by the environment and password login turned off, as the wiki describes for OIDC_DISABLE_PASSWORD
	api = await startApi({
		env: {
			OIDC_ISSUER_URL: "https://idp.example.com",
			OIDC_CLIENT_ID: "npmpro",
			OIDC_CLIENT_SECRET: "client-secret",
			OIDC_REDIRECT_DOMAIN: "npm.example.com",
			OIDC_DISABLE_PASSWORD: "true",
		},
	});
});
after(() => api?.stop());

it("refuses the password login when only OIDC may be used, even with the right password", async () => {
	const setup = await api.client().post("/users/setup", {
		name: "Admin",
		email: "admin@example.com",
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(setup.status, 201);
	const refused = await api.client().post("/tokens", { identity: "admin@example.com", secret: PASSWORD });
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.message, "Non OIDC login is disabled");
	assert.equal(setCookie(refused, "__Host-Http-token"), undefined);
});

it("tells the sign-in page that the password login is off", async () => {
	const health = await api.client().get("");
	assert.equal(health.status, 200);
	assert.equal(health.body.password, false);
	assert.equal(health.body.oidc.active, true);
});

it("refuses the password login before the body is checked", async () => {
	const refused = await api.client().post("/tokens", { identity: "" });
	assert.equal(refused.status, 403);
	assert.equal(refused.body.error.message, "Non OIDC login is disabled");
});
