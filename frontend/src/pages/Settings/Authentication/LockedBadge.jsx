import { T } from "src/locale";

// the badge text of a lock by another setting's env var (backend LOCK_REASONS)
const REASON_BADGES = {
	"key-size": "settings.runtime.locked.follows",
	"ocsp-stapling-off": "settings.runtime.locked.off-because",
	"must-staple": "settings.runtime.locked.required-by",
	goaccess: "settings.runtime.locked.required-by",
	// GoAccess turned on by the GoAccess report setting, not by an env var: the text names the setting
	"goaccess-setting": "settings.runtime.locked.required-by-goaccess-setting",
	"force-mlkem": "settings.runtime.locked.required-by",
	// post-quantum only switched on by its setting, not by an env var
	"force-mlkem-setting": "settings.nginx.locked.post-quantum",
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

// whether LockReason has a sentence for this lock
const hasLockReason = (env, reason) => Boolean(env && Object.hasOwn(REASON_BADGES, reason));

/**
 * Why another setting's env var locks a setting (one sentence), or nothing for a direct lock
 */
function LockReason({ env, reason }) {
	if (!hasLockReason(env, reason)) return null;
	return <T id={`settings.runtime.locked.reason.${reason}`} data={{ env }} />;
}

export { hasLockReason, LockedBadge, LockReason };
