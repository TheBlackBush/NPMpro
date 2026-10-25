import { T } from "src/locale";

// the badge text of a lock by another setting's env var (backend LOCK_REASONS)
const REASON_BADGES = {
	"key-size": "settings.runtime.locked.follows",
	"ocsp-stapling-off": "settings.runtime.locked.off-because",
	"must-staple": "settings.runtime.locked.required-by",
	goaccess: "settings.runtime.locked.required-by",
	// traffic statistics kept on by LOGROTATE (Environment page)
	"write-log-files": "settings.runtime.locked.on-because",
};

const badgeIdOf = (env, reason) => {
	if (!env) return "settings.authentication.locked";
	return REASON_BADGES[reason] ?? "settings.runtime.locked";
};

/**
 * "Set by environment", with `env` "Set by <ENV>", and with an indirect lock `reason` its own wording ("Follows
 * <ENV>", "Off because of <ENV>", "Required by <ENV>")
 */
function LockedBadge({ env, reason, className = "ms-2" }) {
	return (
		<span className={`badge bg-secondary-lt text-wrap text-break ${className}`}>
			<T id={badgeIdOf(env, reason)} data={env ? { env } : undefined} />
		</span>
	);
}

/**
 * Why another setting's env var locks a setting (one sentence), or nothing for a direct lock
 */
function LockReason({ env, reason }) {
	if (!(env && Object.hasOwn(REASON_BADGES, reason))) return null;
	return <T id={`settings.runtime.locked.reason.${reason}`} data={{ env }} />;
}

export { LockedBadge, LockReason };
