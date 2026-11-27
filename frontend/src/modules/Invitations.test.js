import assert from "node:assert/strict";
import { it } from "node:test";
import {
	invitationOutcome,
	invitationsOffered,
	inviteOptionShown,
	resendShown,
	resetWording,
	userCreatePayload,
} from "./Invitations.js";

const email = { configured: true, invitations: true };
const notifications = { publicUrl: "https://npm.example.com" };

it("invitations are offered with mail, the switch and a public URL", () => {
	assert.equal(invitationsOffered(email, notifications), true);
	assert.equal(invitationsOffered({ ...email, configured: false }, notifications), false);
	assert.equal(invitationsOffered({ ...email, invitations: false }, notifications), false);
	assert.equal(invitationsOffered(email, { publicUrl: "" }), false);
	assert.equal(invitationsOffered(email, { publicUrl: "not a url" }), false);
	assert.equal(invitationsOffered(email, undefined), false);
	assert.equal(invitationsOffered(undefined, notifications), false);
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
