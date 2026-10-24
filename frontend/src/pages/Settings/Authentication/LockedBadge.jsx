import { T } from "src/locale";

function LockedBadge() {
	return (
		<span className="badge bg-secondary-lt ms-2">
			<T id="settings.authentication.locked" />
		</span>
	);
}

export { LockedBadge };
