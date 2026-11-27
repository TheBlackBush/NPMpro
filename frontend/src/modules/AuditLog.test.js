import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, auditActorName } from "./AuditLog.js";

// the audit log builds these ids at runtime, so check-keys.sh does not see them
it("every audit log object type has a label in en.json", () => {
	const missing = AUDIT_OBJECT_TYPES.filter((t) => !(t in en));
	assert.deepEqual(missing, []);
});

it("every audit log action has a filter label and an event text in en.json", () => {
	const missing = AUDIT_ACTIONS.flatMap((a) => [`audit-log.action.${a}`, `object.event.${a}`]).filter(
		(id) => !(id in en),
	);
	assert.deepEqual(missing, []);
});

it("the token events are in the lists", () => {
	assert.ok(AUDIT_OBJECT_TYPES.includes("api-token"));
	for (const a of ["revoked", "expired", "first-used"]) assert.ok(AUDIT_ACTIONS.includes(a));
});

it("the ACME account events are in the lists", () => {
	assert.ok(AUDIT_OBJECT_TYPES.includes("acme-account"));
	for (const a of [
		"registered",
		"registration-failed",
		"email-updated",
		"replaced",
		"replace-failed",
		"ca-changed",
		"domains-changed",
	]) {
		assert.ok(AUDIT_ACTIONS.includes(a), a);
	}
});

it("the password reset and invitation events are in the lists", () => {
	for (const a of ["password-reset", "invitation-accepted", "mail-failed"]) assert.ok(AUDIT_ACTIONS.includes(a), a);
});

it("shows an entry NPMpro wrote itself (user id 0) as NPMpro, a missing user as deleted", () => {
	const labels = { system: "NPMpro", deleted: "Deleted User" };
	assert.equal(auditActorName({ user: { name: "Ann" }, userId: 1 }, labels), "Ann");
	assert.equal(auditActorName({ user: null, userId: 0 }, labels), "NPMpro");
	assert.equal(auditActorName({ userId: 0 }, labels), "NPMpro");
	assert.equal(auditActorName({ user: null, userId: 7 }, labels), "Deleted User");
	assert.equal(auditActorName({ user: null }, labels), "Deleted User");
});
