import { Link } from "react-router";
import { Card } from "src/components/ui/card";
import { cn } from "src/lib/utils";

// icon colour per tone, whole class names so Tailwind finds them
const ICON_TONES = {
	success: "text-success",
	info: "text-info",
	warning: "text-warning",
	destructive: "text-destructive",
	muted: "text-muted-foreground",
	primary: "text-primary",
};

/**
 * Stat card: a card with a label, a big value and an optional hint line. With `to` the whole card links there.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.label     label text
 * @param {import("react").ReactNode} props.value     the big value
 * @param {import("react").ReactNode} [props.hint]    small line under the value, cut with an ellipsis
 * @param {boolean} [props.hintWrap]                  wrap the hint instead of cutting it (a hint the user must read
 *                                                    in full, such as a link)
 * @param {import("react").ElementType} [props.icon]  icon shown next to the label
 * @param {"success"|"info"|"warning"|"destructive"|"muted"|"primary"} [props.tone]  icon colour, default "muted"
 * @param {import("react").ReactNode} [props.children]          extra content under the hint (e.g. a sparkline)
 * @param {string} [props.to]                         route to link to
 * @param {string} [props.className]                  sizes the card in the caller's grid
 */
function StatCard({ label, value, hint, hintWrap = false, icon: Icon, tone = "muted", to, children, className }) {
	const body = (
		<div className="flex min-w-0 flex-col gap-1 px-(--card-spacing)">
			<div className="flex items-center gap-2">
				<div className="min-w-0 text-sm text-muted-foreground">{label}</div>
				{Icon ? (
					<div className="ml-auto leading-none">
						<Icon className={cn("size-5", ICON_TONES[tone] ?? ICON_TONES.muted)} aria-hidden="true" />
					</div>
				) : null}
			</div>
			<div className="truncate text-2xl font-semibold">{value}</div>
			{hint ? (
				<div className={cn("text-sm text-muted-foreground", hintWrap ? "text-wrap" : "truncate")}>{hint}</div>
			) : null}
			{children}
		</div>
	);
	if (to) {
		// the link is the grid item and carries the focus ring; the card fills it
		return (
			<Link
				to={to}
				className={cn(
					"block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
					className,
				)}
			>
				<Card className="h-full transition-colors hover:bg-muted/50">{body}</Card>
			</Link>
		);
	}
	return <Card className={className}>{body}</Card>;
}

export { StatCard };
