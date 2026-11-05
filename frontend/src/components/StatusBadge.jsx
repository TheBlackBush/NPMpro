import { Badge } from "src/components/ui/badge";
import { cn } from "src/lib/utils";

// Text and tint per tone. The text uses the plain status token (not the -foreground one, which is made for text on
// a solid status colour): on the 15 percent tint it measures at least 4.5:1 in both themes, except destructive in the
// light theme, which is darkened (6.6:1). The dot is the token colour itself (at least 4.7:1 against the page).
const tones = {
	success: {
		badge: "border-success/30 bg-success/15 text-success",
		dot: "bg-success",
	},
	info: {
		badge: "border-info/30 bg-info/15 text-info",
		dot: "bg-info",
	},
	warning: {
		badge: "border-warning/30 bg-warning/15 text-warning",
		dot: "bg-warning",
	},
	destructive: {
		badge: "border-destructive/30 bg-destructive/15 text-[color-mix(in_oklab,var(--destructive)_75%,black)] dark:text-destructive",
		dot: "bg-destructive",
	},
	muted: {
		badge: "border-border bg-muted text-foreground",
		dot: "bg-muted-foreground",
	},
};

/**
 * A state label with a coloured dot: tone is success, info, warning, destructive or muted. pulse animates the dot (for a
 * live state, not under prefers-reduced-motion); dot={false} leaves the dot out (a pure label).
 */
export function StatusBadge({ tone = "muted", children, pulse, dot = true, className, ...rest }) {
	const t = tones[tone] || tones.muted;
	return (
		<Badge {...rest} variant="outline" className={cn("h-auto gap-1.5 py-0.5", t.badge, className)}>
			{dot ? (
				<span
					aria-hidden="true"
					className={cn("size-1.5 shrink-0 rounded-full", t.dot, pulse && "motion-safe:animate-pulse")}
				/>
			) : null}
			{children}
		</Badge>
	);
}
