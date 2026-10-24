import assert from "node:assert/strict";
import { it } from "node:test";
import { carryAuthMethod } from "../lib/auth-method.js";

it("keeps oidc and defaults everything else to password", () => {
	assert.equal(carryAuthMethod({ id: 1, auth_method: "oidc" }), "oidc");
	assert.equal(carryAuthMethod({ id: 1, auth_method: "password" }), "password");
	assert.equal(carryAuthMethod({ id: 1 }), "password");
	assert.equal(carryAuthMethod(undefined), "password");
});
