// the object types and actions the audit log filters offer; their labels are built at runtime from these ids
// (`<type>`, `audit-log.action.<action>` and `object.event.<action>`), AuditLog.test.js pins them against en.json
export const AUDIT_OBJECT_TYPES = Object.freeze([
	"proxy-host",
	"redirection-host",
	"dead-host",
	"stream",
	"access-list",
	"certificate",
	"dns-credential",
	"dns-domain",
	"user",
	"setting",
	"backup-schedule",
	"backup",
	"database",
	"api-token",
	"acme-account",
]);

export const AUDIT_ACTIONS = Object.freeze([
	"created",
	"updated",
	"deleted",
	"enabled",
	"disabled",
	"backup-succeeded",
	"backup-failed",
	"moved",
	"move-failed",
	"restored",
	"merged",
	"imported",
	"exported",
	"uploaded",
	"downloaded",
	"oidc-linked",
	"oidc-unlinked",
	"oidc-refused",
	"revoked",
	"expired",
	"first-used",
	"registered",
	"registration-failed",
	"email-updated",
	"replaced",
	"replace-failed",
	"ca-changed",
	"domains-changed",
]);

/**
 * The name shown as the user of an audit entry: the user's own name; "NPMpro" for an entry NPMpro wrote itself
 * (user id 0, a certificate renewal for example); "Deleted User" for an entry whose user no longer exists
 *
 * @param {{ user?: { name?: string } | null, userId?: number }} row
 * @param {{ system: string, deleted: string }} labels
 * @returns {string}
 */
export const auditActorName = (row, { system, deleted }) => {
	if (row.user) return row.user.name;
	return row.userId === 0 ? system : deleted;
};
