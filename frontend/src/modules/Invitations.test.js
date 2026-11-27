import assert from "node:assert/strict";
import { it } from "node:test";
import {
	invitationOutcome,
	invitationsOffered,
	inviteOptionShown,
	listedUsers,
	resendShown,
	resetWording,
	signInLabels,
	userCreatePayload,
} from "./Invitations.js";

const email = { configured: true, invitations: true };
const notifications = { publicUrl: "https://npm.example.com" };

const health = { password: true };

it("invitations are offered with mail, the switch, a public URL and password sign-in on", () => {
	assert.equal(invitationsOffered(email, notifications, health), true);
	assert.equal(invitationsOffered({ ...email, configured: false }, notifications, health), false);
	assert.equal(invitationsOffered({ ...email, invitations: false }, notifications, health), false);
	assert.equal(invitationsOffered(email, { publicUrl: "" }, health), false);
	assert.equal(invitationsOffered(email, { publicUrl: "not a url" }, health), false);
	assert.equal(invitationsOffered(email, undefined, health), false);
	assert.equal(invitationsOffered(undefined, notifications, health), false);
	// OIDC turned password sign-in off, or the health answer is not loaded yet
	assert.equal(invitationsOffered(email, notifications, { password: false }), false);
	assert.equal(invitationsOffered(email, notifications, undefined), false);
});

it("the list marks a user invited only while invitations are offered", () => {
	const users = [
		{ id: 1, invited: true },
		{ id: 2, invited: false, npmproHasPassword: true },
	];
	assert.deepEqual(listedUsers(users, true), users);
	assert.deepEqual(listedUsers(users, false), [
		{ id: 1, invited: false },
		{ id: 2, invited: false, npmproHasPassword: true },
	]);
	assert.equal(listedUsers(users, false)[1], users[1]);
	assert.deepEqual(listedUsers(undefined, false), []);
	assert.deepEqual(listedUsers(undefined, true), []);
});

it("the sign-in column says Invited only for a listed invited user, else the methods or nothing", () => {
	assert.deepEqual(signInLabels({ invited: true }), ["user.invited"]);
	assert.deepEqual(signInLabels(listedUsers([{ invited: true }], false)[0]), []);
	assert.deepEqual(signInLabels({ invited: false }), []);
	assert.deepEqual(signInLabels({ npmproHasPassword: true, npmproOidcLinkedOn: "2026-11-01" }), [
		"user.sign-in.local",
		"user.sign-in.oidc",
	]);
	// a sign-in method wins over a stale flag
	assert.deepEqual(signInLabels({ invited: true, npmproHasPassword: true }), ["user.sign-in.local"]);
	assert.deepEqual(signInLabels(undefined), []);
});

it("the invite option is for an administrator creating a user while offered", () => {
	assert.equal(inviteOptionShown({ offered: true, isAdmin: true, isNew: true }), true);
	assert.equal(inviteOptionShown({ offered: false, isAdmin: true, isNew: true }), false);
	assert.equal(inviteOptionShown({ offered: true, isAdmin: false, isNew: true }), false);
	assert.equal(inviteOptionShown({ offered: true, isAdmin: true, isNew: false }), false);
});

it("Send invitation again is for an invited user while offered", () => {
	assert.equal(resendShown({ invited: true }, true), true);
	assert.equal(resendShown({ invited: true }, false), false);
	assert.equal(resendShown({ invited: false }, true), false);
	assert.equal(resendShown({}, true), false);
	assert.equal(resendShown(undefined, true), false);
});

it("the create body carries invite only when shown and ticked", () => {
	assert.deepEqual(userCreatePayload({ name: "A", invite: true }, true), { name: "A", invite: true });
	assert.deepEqual(userCreatePayload({ name: "A", invite: false }, true), { name: "A" });
	assert.deepEqual(userCreatePayload({ name: "A", invite: true }, false), { name: "A" });
});

it("the outcome of an invitation answer", () => {
	assert.equal(invitationOutcome({ id: 1 }), null);
	assert.deepEqual(invitationOutcome({ invitation: { sent: true } }), { sent: true });
	assert.deepEqual(
		invitationOutcome({
			invitation: { sent: false, error: "x", errorI18n: "error.invite-mail-failed", errorValues: { error: "x" } },
		}),
		{ sent: false, error: "x", i18n: "error.invite-mail-failed", values: { error: "x" } },
	);
	assert.deepEqual(invitationOutcome({ invitation: { sent: false } }), {
		sent: false,
		error: "",
		i18n: undefined,
		values: undefined,
	});
});

it("the reset page words an invitation differently", () => {
	assert.deepEqual(resetWording("invite"), {
		title: "reset-password.invite.title",
		button: "reset-password.invite.button",
		done: "reset-password.invite.done",
	});
	assert.deepEqual(resetWording("reset"), {
		title: "reset-password.title",
		button: "save",
		done: "reset-password.done",
	});
	assert.deepEqual(resetWording(undefined), {
		title: "reset-password.title",
		button: "save",
		done: "reset-password.done",
	});
});
