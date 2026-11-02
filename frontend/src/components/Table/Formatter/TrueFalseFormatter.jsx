import { StatusBadge } from "src/components/StatusBadge";
import { T } from "src/locale";

// the colour names the callers pass (Tabler names) mapped to a status tone
const toneOf = (color) => {
	switch (color) {
		case "lime":
		case "green":
		case "success":
			return "success";
		case "orange":
		case "yellow":
		case "warning":
			return "warning";
		case "red":
		case "danger":
		case "destructive":
			return "destructive";
		default:
			return "muted";
	}
};

export function TrueFalseFormatter({
	value,
	trueLabel = "enabled",
	trueColor = "lime",
	falseLabel = "disabled",
	falseColor = "red",
}) {
	return (
		<StatusBadge tone={toneOf(value ? trueColor : falseColor)}>
			<T id={value ? trueLabel : falseLabel} />
		</StatusBadge>
	);
}
