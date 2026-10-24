import { T } from "src/locale";

// "Set by environment", or with `env` the name of the env var that sets the value
function LockedBadge({ env }) {
	return (
		<span className="badge bg-secondary-lt ms-2 text-wrap text-break">
			{env ? <T id="settings.runtime.locked" data={{ env }} /> : <T id="settings.authentication.locked" />}
		</span>
	);
}

export { LockedBadge };
