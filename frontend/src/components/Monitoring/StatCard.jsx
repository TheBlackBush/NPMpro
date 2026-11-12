import { Link } from "react-router";
import { TruncatedText } from "src/components/TruncatedText";
import { Card } from "src/components/ui/card";
import { cn } from "src/lib/utils";
import { CARD_LINK, CARD_POP } from "src/modules/CardLink";

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
 * @param {import("react").ReactNode} [props.value]   the big value; left out, the card shows its label and children
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
			{value === null || value === undefined ? null : (
				// inside a link a tap must follow the link, so the tooltip opens on hover and focus only there
				<TruncatedText className="text-2xl font-semibold" tap={!to}>
					{value}
				</TruncatedText>
			)}
			{hint ? (
				<div className={cn("text-sm text-muted-foreground", hintWrap ? "text-wrap" : "truncate")}>{hint}</div>
			) : null}
			{children}
		</div>
	);
	if (to) {
		// the link is the grid item and carries the focus ring; the card fills it
		return (
			<Link to={to} className={cn(CARD_LINK, className)}>
				<Card className={CARD_POP}>{body}</Card>
			</Link>
		);
	}
	return <Card className={className}>{body}</Card>;
}

export { StatCard };
