import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Alert } from "src/components/ui/alert";
import { cn } from "src/lib/utils";

// an informational notice: role "status" (polite) unless the caller asks for "alert" (assertive)
function NoticeAlert({ variant = "warning", children, className, role = "status" }) {
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
