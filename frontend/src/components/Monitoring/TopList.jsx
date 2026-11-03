import { Link } from "react-router";
import { Badge } from "src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "src/components/ui/card";
import { Progress } from "src/components/ui/progress";
import { currentLocale, intl } from "src/locale";
import { formatCount, shareBar } from "src/modules/Monitoring";

const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

// share bar colour per tone, whole class names so Tailwind finds them
const BAR_TONES = {
	primary: "[&>[data-slot=progress-indicator]]:bg-primary",
	destructive: "[&>[data-slot=progress-indicator]]:bg-destructive",
};

/**
 * Ranked top list card: rank, name, count and a share bar per row.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {{ key: string, label: import("react").ReactNode, title?: string, value: number,
 *          extra?: string, badge?: import("react").ReactNode, detail?: import("react").ReactNode, to?: string,
 *          ariaLabel?: string }[]} props.items
 *        rows in display order; `title` is the plain text for the native tooltip of a truncated name, `extra` a short
 *        marker after the name (such as "+2"), `badge` a badge after it, `detail` a small line under the name
 *        and `to` a route the whole row links to (`ariaLabel` names that link; its share bar is then hidden from
 *        assistive technology)
 * @param {number} [props.total]        the 100 % for the share bar and percentage, default the sum of the values
 * @param {(n: number) => string} [props.formatValue]  count text, default formatCount
 * @param {"primary"|"destructive"} [props.tone]  colour of the share bars, default "primary" (CrowdSec uses "destructive")
 * @param {import("react").ReactNode} [props.empty]   text when there are no rows
 * @param {string} [props.className]    classes for the card, which sizes it in the caller's grid
 */
function TopList({ title, items, total, formatValue = formatCount, tone = "primary", empty, className }) {
	const sum = total ?? items.reduce((acc, item) => acc + (Number(item.value) || 0), 0);
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle role="heading" aria-level={3}>
					{title}
				</CardTitle>
			</CardHeader>
			{items.length ? (
				<div className="flex flex-col">
					{items.map((item, idx) => {
						const width = shareBar(item.value, sum);
						const share = percentFormat.format(width / 100);
						const linked = Boolean(item.to);
						const Row = linked ? Link : "div";
						return (
							<Row
								key={item.key}
								to={linked ? item.to : undefined}
								aria-label={linked ? item.ariaLabel : undefined}
								className={
									linked
										? "block rounded-md px-3 py-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
										: "block px-3 py-2"
								}
							>
								<div className="flex items-center gap-2">
									<Badge variant="secondary" className="min-w-[2em] justify-center">
										{idx + 1}
									</Badge>
									<div className="flex min-w-0 items-center gap-1">
										<span className="truncate" title={item.title}>
											{item.label}
										</span>
										{item.extra ? (
											<Badge variant="secondary" title={item.title}>
												{item.extra}
											</Badge>
										) : null}
										{item.badge ?? null}
									</div>
									<div className="ms-auto whitespace-nowrap tabular-nums">
										<span className="font-medium">{formatValue(item.value)}</span>
										<span className="ms-2 text-sm text-muted-foreground">{share}</span>
									</div>
								</div>
								{item.detail ? (
									<div className="truncate text-sm text-muted-foreground">{item.detail}</div>
								) : null}
								<Progress
									value={width}
									className={`mt-1 h-1 ${BAR_TONES[tone] ?? BAR_TONES.primary}`}
									// inside a link the row's aria-label already names it; the bar would repeat it
									aria-hidden={linked ? "true" : undefined}
									aria-label={intl.formatMessage(
										{ id: "monitoring.share" },
										{ share, name: item.title ?? item.key },
									)}
								/>
							</Row>
						);
					})}
				</div>
			) : (
				<CardContent className="text-muted-foreground">{empty}</CardContent>
			)}
		</Card>
	);
}

export { TopList };
