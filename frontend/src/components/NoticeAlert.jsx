import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Alert } from "src/components/ui/alert";
import { cn } from "src/lib/utils";

function NoticeAlert({ variant = "warning", children, className, role }) {
	const Icon = variant === "info" ? InfoIcon : TriangleAlertIcon;
	return (
		<Alert
			role={role}
			className={cn(
				variant === "info" ? "border-primary/50 bg-primary/10" : "border-warning/50 bg-warning/10",
				"text-foreground",
				className,
			)}
		>
			<Icon className={variant === "info" ? "text-primary" : "text-warning"} aria-hidden="true" />
			<div className="text-sm">{children}</div>
		</Alert>
	);
}

export { NoticeAlert };
