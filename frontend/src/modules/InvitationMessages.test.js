import assert from "node:assert/strict";
import { it } from "node:test";
import { invitationFailureText } from "./InvitationMessages.js";

const messages = {
	"error.invite-mail-failed": "Could not send: {error}",
	"user.invitation.created-not-sent": "It exists.",
};
const format = (id, values) => (messages[id] ?? id).replace("{error}", values?.error ?? "");
const has = (id) => id in messages;

it("uses the translated reason and says the user exists after a create", () => {
	const outcome = { sent: false, error: "raw", i18n: "error.invite-mail-failed", values: { error: "refused" } };
	assert.equal(invitationFailureText(outcome, { created: false, format, has }), "Could not send: refused");
	assert.equal(invitationFailureText(outcome, { created: true, format, has }), "Could not send: refused It exists.");
});

it("falls back to the plain text when the key is unknown or missing", () => {
	assert.equal(
		invitationFailureText({ sent: false, error: "raw", i18n: "error.nope" }, { created: false, format, has }),
		"raw",
	);
	assert.equal(invitationFailureText({ sent: false, error: "raw" }, { created: false, format, has }), "raw");
});
