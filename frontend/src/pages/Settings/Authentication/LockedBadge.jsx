import { Lock } from "lucide-react";
import { SettingBadge } from "src/components";
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

/**
 * A direct lock reads "Set by environment" and explains "Set by <ENV>" in the badge's tooltip. An indirect lock
 * `reason` keeps its own wording ("Follows <ENV>", "Off because of <ENV>", "Required by <ENV>") and its tooltip is
 * the reason's sentence. Without `env` the badge is the plain "Set by environment".
 */
function LockedBadge({ env, reason, className }) {
	const name = <span className="font-mono">{env}</span>;
	if (env && Object.hasOwn(REASON_BADGES, reason)) {
		return (
			<SettingBadge
				icon={Lock}
				className={className}
				description={<T id={`settings.runtime.locked.reason.${reason}`} data={{ env: name }} />}
			>
				<T id={REASON_BADGES[reason]} data={{ env: name }} />
			</SettingBadge>
		);
	}
	return (
		<SettingBadge
			icon={Lock}
			className={className}
			description={env ? <T id="settings.runtime.locked" data={{ env: name }} /> : undefined}
		>
			<T id="settings.authentication.locked" />
		</SettingBadge>
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
