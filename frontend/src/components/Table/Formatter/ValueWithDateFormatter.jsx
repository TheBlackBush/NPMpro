import { formatDateTime, T } from "src/locale";

// a disabled row keeps its red name; the status column says it is disabled, so the second line stays the date
export function ValueWithDateFormatter({ value, createdOn, disabled }) {
	return (
		<div className="flex-fill">
			<div className="fw-medium">
				<div className={`fw-medium ${disabled ? "text-red" : ""}`}>{value}</div>
			</div>
			<div className="text-secondary mt-1">
				<T id="created-on" data={{ date: formatDateTime(createdOn) }} />
			</div>
		</div>
	);
}
