import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { generateApiToken } from "../lib/api-token.js";
import { PASSWORD, startApi } from "./support/api.js";

let api;

before(async () => {
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

it("a token works with password login off, and the password is still refused", async () => {
	const setup = await api.client().post("/users/setup", {
		name: "Admin",
		email: "admin@example.com",
		auth: { type: "password", secret: PASSWORD },
	});
	assert.equal(setup.status, 201);
	const made = generateApiToken();
	const now = Math.floor(Date.now() / 1000);
	await api.db("npmpro_api_token").insert({
		user_id: setup.body.id,
		name: "oidc",
		lookup_id: made.lookupId,
		secret_hash: made.secretHash,
		visibility: "all",
		proxy_hosts: "view",
		redirection_hosts: "view",
		dead_hosts: "view",
		streams: "view",
		access_lists: "view",
		certificates: "view",
		created_on: now,
		expires_on: now + 3600,
	});
	const client = api.client();
	const listed = await client.get("/nginx/proxy-hosts", { headers: { authorization: `Bearer ${made.token}` } });
	assert.equal(listed.status, 200);
	const refused = await api.client().post("/tokens", { identity: "admin@example.com", secret: PASSWORD });
	assert.equal(refused.status, 403);
});
