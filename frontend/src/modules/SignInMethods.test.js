import assert from "node:assert/strict";
import { it } from "node:test";
import { signInMethods } from "./SignInMethods.js";

const LINKED_ON = "2026-11-12 12:00:00";

it("lists how a user can sign in", () => {
	assert.deepEqual(signInMethods({ npmproHasPassword: true, npmproOidcLinkedOn: null }), ["local"]);
	assert.deepEqual(signInMethods({ npmproHasPassword: false, npmproOidcLinkedOn: LINKED_ON }), ["oidc"]);
	assert.deepEqual(signInMethods({ npmproHasPassword: true, npmproOidcLinkedOn: LINKED_ON }), ["local", "oidc"]);
	assert.deepEqual(signInMethods({ npmproHasPassword: false, npmproOidcLinkedOn: null }), []);
	assert.deepEqual(signInMethods({}), []);
	assert.deepEqual(signInMethods(undefined), []);
});
