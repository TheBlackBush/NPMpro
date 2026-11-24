import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Alert } from "src/components/ui/alert";
import { cn } from "src/lib/utils";

const VARIANTS = {
	info: { Icon: InfoIcon, box: "border-primary/50 bg-primary/10", icon: "text-primary" },
	warning: { Icon: TriangleAlertIcon, box: "border-warning/50 bg-warning/10", icon: "text-warning" },
	destructive: { Icon: CircleAlertIcon, box: "border-destructive/50 bg-destructive/10", icon: "text-destructive" },
};

// a notice (variant info, warning or destructive; a warning that does not block): role "status" (polite) unless the
// caller asks for "alert" (assertive)
function NoticeAlert({ variant = "warning", children, className, role = "status", ...rest }) {
	const { Icon, box, icon } = VARIANTS[variant] ?? VARIANTS.warning;
	return (
		<Alert role={role} className={cn(box, "text-foreground", className)} {...rest}>
			<Icon className={icon} aria-hidden="true" />
			<div className="text-sm">{children}</div>
		</Alert>
	);
}

export { NoticeAlert };
