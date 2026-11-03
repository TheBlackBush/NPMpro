import { Alert } from "src/components/ui/alert";
import { cn } from "src/lib/utils";
import { T } from "src/locale";

// the tint of each variant (the old Tabler alert colours): border and background from the theme's status colours
const VARIANTS = {
	info: "border-primary/50 bg-primary/10",
	success: "border-success/50 bg-success/10",
	warning: "border-warning/50 bg-warning/10",
	danger: "border-destructive/50 bg-destructive/10",
	orange: "border-warning/50 bg-warning/10",
	secondary: "border-border bg-muted/50",
};

/**
 * An alert with an icon for a settings section status line. Pass `id` for a translated text or `children` for own
 * content; `icon` is any icon component (lucide or Tabler). It is a status region itself (role="status"); inside a
 * live region that is always mounted, pass live={false} so the announcement is not nested in a second region.
 */
function StatusAlert({ variant, icon: Icon, id, data, className, children, live = true }) {
	return (
		<Alert
			role={live ? "status" : undefined}
			className={cn("text-foreground", VARIANTS[variant] ?? VARIANTS.secondary, className)}
		>
			<Icon aria-hidden="true" />
			<div className="text-sm wrap-break-word">{id ? <T id={id} data={data} /> : children}</div>
		</Alert>
	);
}

export { StatusAlert };
