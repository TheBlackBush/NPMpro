import assert from "node:assert/strict";
import { it } from "node:test";
import en from "../../translations/ui/en.json" with { type: "json" };
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES } from "./AuditLog.js";

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
