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

it("marks the users that have a password and the invited ones (enabled, no password, no OIDC link)", () => {
	const users = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, is_disabled: true }];
	assert.deepEqual(withPasswordFlag(users, [2, 7], [3]), [
		{ id: 1, npmpro_has_password: false, invited: true },
		{ id: 2, npmpro_has_password: true, invited: false },
		{ id: 3, npmpro_has_password: false, invited: false },
		{ id: 4, is_disabled: true, npmpro_has_password: false, invited: false },
	]);
	assert.equal(withPasswordFlag([{ id: 1 }], [])[0].invited, true);
	// any auth row (TOTP and backup codes without a password) means not invited, like isInvited
	assert.deepEqual(withPasswordFlag([{ id: 5 }, { id: 6 }], [], [], [5]), [
		{ id: 5, npmpro_has_password: false, invited: false },
		{ id: 6, npmpro_has_password: false, invited: true },
	]);
});
