import { cn } from "src/lib/utils";
import { formatDateTime, T } from "src/locale";

// a disabled row keeps its red name; the status column says it is disabled, so the second line stays the date
export function ValueWithDateFormatter({ value, createdOn, disabled }) {
	return (
		<div className="flex-1">
			<div className={cn("font-medium", disabled && "text-destructive")}>{value}</div>
			<div className="mt-1 text-muted-foreground">
				<T id="created-on" data={{ date: formatDateTime(createdOn) }} />
			</div>
		</div>
	);
}
