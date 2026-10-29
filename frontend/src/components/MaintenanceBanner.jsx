import { IconDatabase } from "@tabler/icons-react";
import { useHealth } from "src/hooks";
import { T } from "src/locale";

/**
 * Shown on every page while the health check reports a database move: changes answer 409 until the restart.
 * It reads the health query the app polls already, and cannot be dismissed while the move runs.
 */
function MaintenanceBanner() {
	const { data } = useHealth();
	if (data?.maintenance !== "database-move") return null;
	return (
		<div className="alert alert-warning mb-3" role="status">
			<div className="alert-icon">
				<IconDatabase className="icon alert-icon" aria-hidden="true" />
			</div>
			<div>
				<T id="maintenance.database-move" />
			</div>
		</div>
	);
}

export { MaintenanceBanner };
