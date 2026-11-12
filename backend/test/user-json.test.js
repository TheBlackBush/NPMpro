import assert from "node:assert/strict";
import { it } from "node:test";
import { publicUserJson, withPasswordFlag } from "../lib/user-json.js";

it("the API never sees the issuer or subject (Review Focus 4)", () => {
	const json = publicUserJson({
		id: 1,
		email: "a@example.com",
		npmpro_oidc_issuer: "https://idp.example.com",
		npmpro_oidc_subject: "s1",
		npmpro_oidc_linked_on: "2026-11-12 12:00:00",
	});
	assert.deepEqual(json, { id: 1, email: "a@example.com", npmpro_oidc_linked_on: "2026-11-12 12:00:00" });
	assert.deepEqual(publicUserJson({ id: 2 }), { id: 2, npmpro_oidc_linked_on: null });
});

it("marks the users that have a password", () => {
	const users = [{ id: 1 }, { id: 2 }];
	assert.deepEqual(withPasswordFlag(users, [2, 7]), [
		{ id: 1, npmpro_has_password: false },
		{ id: 2, npmpro_has_password: true },
	]);
});
