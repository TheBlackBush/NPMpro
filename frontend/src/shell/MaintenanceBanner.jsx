import { Database } from "lucide-react";
import { Alert, AlertDescription } from "src/components/ui/alert";
import { useHealth } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";

/**
 * Shown on every page while the health check reports a database move: changes answer 409 until the restart.
 * It reads the health query the app polls already, and cannot be dismissed while the move runs.
 */
export function MaintenanceBanner({ className } = {}) {
	const { data } = useHealth();
	if (data?.maintenance !== "database-move") return null;
	return (
		<Alert role="status" className={cn("mb-4", className)}>
			<Database aria-hidden="true" />
			<AlertDescription>
				<T id="maintenance.database-move" />
			</AlertDescription>
		</Alert>
	);
}
