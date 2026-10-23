import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import cn from "clsx";

function NoticeAlert({ variant = "warning", children, className, role }) {
	const Icon = variant === "info" ? IconInfoCircle : IconAlertTriangle;
	return (
		<div className={cn("alert", `alert-${variant}`, className)} role={role}>
			<div className="alert-icon">
				<Icon className="icon" aria-hidden="true" />
			</div>
			<div>{children}</div>
		</div>
	);
}

export { NoticeAlert };
