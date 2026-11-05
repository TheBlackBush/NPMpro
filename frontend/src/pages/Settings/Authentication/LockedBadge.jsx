import { Lock } from "lucide-react";
import { useRef, useState } from "react";
import { SettingBadge } from "src/components";
import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
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
 * A direct lock reads "Set by environment"; hovering or focusing it (or tapping it on a touch screen) shows "Set by
 * <ENV>" in a tooltip, and screen readers get the sentence after the text. An indirect lock `reason` keeps its own
 * wording ("Follows <ENV>", "Off because of <ENV>", "Required by <ENV>") and has no tooltip. Without `env` the badge
 * is the plain "Set by environment".
 */
function LockedBadge({ env, reason, className }) {
	const [open, setOpen] = useState(false);
	// whether the tooltip was open when the press started: a tap toggles it, and the press itself closes it first
	const wasOpen = useRef(false);
	if (env && Object.hasOwn(REASON_BADGES, reason)) {
		return (
			<SettingBadge icon={Lock} className={className}>
				<T id={REASON_BADGES[reason]} data={{ env: <span className="font-mono">{env}</span> }} />
			</SettingBadge>
		);
	}
	if (!env) {
		return (
			<SettingBadge icon={Lock} className={className}>
				<T id="settings.authentication.locked" />
			</SettingBadge>
		);
	}
	const named = <T id="settings.runtime.locked" data={{ env: <span className="font-mono">{env}</span> }} />;
	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				<SettingBadge
					icon={Lock}
					className={className}
					description={named}
					tabIndex={0}
					onPointerDown={() => {
						wasOpen.current = open;
					}}
					onClick={(event) => {
						// inside a switch's label a click would toggle the switch
						event.preventDefault();
						setOpen(!wasOpen.current);
						wasOpen.current = !wasOpen.current;
					}}
				>
					<T id="settings.authentication.locked" />
				</SettingBadge>
			</TooltipTrigger>
			<TooltipContent>{named}</TooltipContent>
		</Tooltip>
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
