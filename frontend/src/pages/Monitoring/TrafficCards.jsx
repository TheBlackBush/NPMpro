import { UsersIcon } from "lucide-react";
import { Link } from "react-router";
import { StatCard } from "src/components/Monitoring";
import { useMonitoringSettings } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { formatCount } from "src/modules/Monitoring";

/**
 * The exact number as a hint under a short value ("5.9k" over "5,948"), nothing when both read the same.
 */
export const exactHint = (n) => {
	const exact = intl.formatNumber(Number(n) || 0);
	return exact === formatCount(n) ? undefined : exact;
};

export function StatusLine({ status }) {
	return (
		<div className="text-sm text-muted-foreground">
			{status.lastRead ? (
				<T id="monitoring.traffic.last-read" data={{ time: formatDateTime(status.lastRead) }} />
			) : (
				<T id="monitoring.traffic.never-read" />
			)}
			{status.skippedLines > 0 ? (
				<>
					<span className="mx-1">·</span>
					<T id="monitoring.traffic.skipped-lines" data={{ count: status.skippedLines }} />
				</>
			) : null}
			{status.droppedRequests > 0 ? (
				<>
					<span className="mx-1">·</span>
					<T id="monitoring.traffic.dropped-requests" data={{ count: status.droppedRequests }} />
				</>
			) : null}
		</div>
	);
}

export function VisitorsCard({ status, totals, range }) {
	const { data: settings } = useMonitoringSettings();
	if (!status.uniqueVisitors) {
		return (
			<StatCard
				label={<T id="monitoring.stat.visitors" />}
				value={<T id="monitoring.stat.visitors.off" />}
				// the card itself is not a link; only the hint links to the settings
				hint={
					<Link to="/settings/monitoring">
						<T id="monitoring.stat.visitors.off.hint" />
					</Link>
				}
				// the link is the way to the setting: shown in full, not cut to one line
				hintWrap
				icon={UsersIcon}
				tone="muted"
			/>
		);
	}
	const visitors = Number(totals.visitors) || 0;
	let hint = range === "1h" ? <T id="monitoring.stat.visitors.today" /> : exactHint(visitors);
	if (totals.visitorsCapped) {
		hint = settings?.visitorsCap ? (
			<T id="monitoring.stat.visitors.capped" data={{ cap: formatCount(settings.visitorsCap) }} />
		) : (
			<T id="monitoring.stat.visitors.capped-short" />
		);
	}
	return (
		<StatCard
			label={<T id="monitoring.stat.visitors" />}
			value={`${formatCount(visitors)}${totals.visitorsCapped ? "+" : ""}`}
			hint={hint}
			icon={UsersIcon}
			tone="primary"
		/>
	);
}
