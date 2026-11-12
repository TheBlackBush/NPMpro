import { FlagIcon, GaugeIcon, ShieldBanIcon, TriangleAlertIcon } from "lucide-react";
import { Flag } from "src/components";
import { countryLabel } from "src/components/Monitoring/CountryName";
import { StatCard } from "src/components/Monitoring/StatCard";
import { useMonitoringSummary } from "src/hooks/useMonitoring";
import { cn } from "src/lib/utils";
import { currentLocale, intl, T } from "src/locale";
import { banSegments, errorSegments, seriesStart, topCountryRows } from "src/modules/DashboardCards";
import { errorRateTone, formatCount, sparklinePoints } from "src/modules/Monitoring";
import { BanReasons, SplitBar } from "./BanReasons";
import { TopCountries } from "./TopCountries";

const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });
const hourFormat = new Intl.DateTimeFormat(currentLocale, { hour: "numeric", minute: "2-digit" });

const WIDTH = 120;
const HEIGHT = 32;

/**
 * 24 hourly request counts as a small area chart; colour follows the text colour of the parent.
 */
function Sparkline({ series }) {
	const values = series.map((s) => s.requests);
	const total = values.reduce((sum, n) => sum + (Number(n) || 0), 0);
	const { line, area } = sparklinePoints(values, WIDTH, HEIGHT);
	return (
		<svg
			className="block size-full text-primary"
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			preserveAspectRatio="none"
			role="img"
			aria-label={intl.formatMessage({ id: "dashboard.monitoring.sparkline" }, { count: total })}
		>
			<polygon points={area} fill="currentColor" opacity="0.15" />
			<polyline
				points={line}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/**
 * Today's 4xx and 5xx answers as a split bar in the lower part of the card's picture, with a legend of two columns
 * under it: a colour dot, the class and its count.
 *
 * @param {object} props
 * @param {ReturnType<typeof errorSegments>} props.segments
 */
function ErrorSplit({ segments }) {
	return (
		<div className="flex h-full flex-col justify-end gap-1.5">
			<SplitBar segments={segments} />
			<ul className="m-0 grid list-none grid-cols-2 gap-x-3 p-0 text-xs text-muted-foreground">
				{segments.map((segment) => (
					<li key={segment.key} className="flex min-w-0 items-center gap-1.5">
						<span className={cn("size-2 shrink-0 rounded-full", segment.tone.dot)} aria-hidden="true" />
						<span className="flex-1">{segment.label}</span>
						<strong className="shrink-0 font-semibold text-foreground tabular-nums">
							{formatCount(segment.count)}
						</strong>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The requests graph with a time axis under it (the first hour of the series on the left, "now" on the right). The
 * axis has the height of the error card's legend, so the graph ends on the line of the error card's bar.
 *
 * @param {object} props
 * @param {Array<{bucket: number, requests: number}>} props.series  series24h of the summary, two points or more
 */
function RequestsGraph({ series }) {
	const start = seriesStart(series);
	return (
		<div className="flex h-full flex-col gap-1.5">
			<div className="min-h-0 flex-1">
				<Sparkline series={series} />
			</div>
			<div className="flex justify-between text-xs text-muted-foreground tabular-nums">
				<span>{start === null ? null : hourFormat.format(start)}</span>
				<T id="dashboard.monitoring.now" />
			</div>
		</div>
	);
}

/**
 * The picture under a card's hint: the same height in every card, so the numbers, hints and pictures of the row line
 * up.
 */
function CardPicture({ children }) {
	return <div className="mt-2 h-18 min-w-0">{children}</div>;
}

// Grid columns by the number of cards shown, so the cards always fill their row; by the width of the dashboard
// column (container queries), so the sidebar layout gets the narrower grid (whole class strings for Tailwind)
const GRID_BY_COUNT = {
	1: "",
	2: "@lg:grid-cols-2",
	3: "@3xl:grid-cols-3",
	4: "@lg:grid-cols-2 @4xl:grid-cols-4",
};

/**
 * Row of up to four monitoring cards above the dashboard tiles. Each card is hidden when its value is unknown.
 * Only rendered for administrators (the summary endpoint is admin only).
 */
function MonitoringRow() {
	const { data } = useMonitoringSummary();
	if (!data) return null;

	const {
		requestsToday,
		series24h,
		errorRateToday,
		clientErrorsToday,
		serverErrorsToday,
		activeBans,
		bansAdded24h,
		topBanReasons,
		topCountriesToday,
		visitorsToday,
	} = data;
	const countries = topCountryRows(topCountriesToday);
	const reasons = banSegments(activeBans, topBanReasons);
	const cards = [
		requestsToday !== null && requestsToday !== undefined ? (
			<StatCard
				key="requests"
				to="/monitoring/traffic"
				icon={GaugeIcon}
				tone="info"
				label={<T id="dashboard.monitoring.requests" />}
				value={formatCount(requestsToday)}
				// the hint line is always there (the visitors, or the graph's span while they are off), so the graph
				// lines up with the pictures of the other cards
				hint={
					typeof visitorsToday === "number" ? (
						<T id="monitoring.visitors" data={{ count: visitorsToday }} />
					) : (
						<T id="dashboard.monitoring.last-24h" />
					)
				}
			>
				<CardPicture>{series24h?.length > 1 ? <RequestsGraph series={series24h} /> : null}</CardPicture>
			</StatCard>
		) : null,
		errorRateToday !== null && errorRateToday !== undefined ? (
			<StatCard
				key="errors"
				to="/monitoring/traffic"
				icon={TriangleAlertIcon}
				tone={errorRateTone(errorRateToday)}
				label={<T id="dashboard.monitoring.error-rate" />}
				value={percentFormat.format(errorRateToday)}
				hint={<T id="monitoring.stat.error-rate.hint" />}
			>
				<CardPicture>
					<ErrorSplit segments={errorSegments(clientErrorsToday, serverErrorsToday)} />
				</CardPicture>
			</StatCard>
		) : null,
		activeBans !== null && activeBans !== undefined ? (
			<StatCard
				key="bans"
				to="/monitoring/crowdsec"
				icon={ShieldBanIcon}
				tone="destructive"
				label={<T id="monitoring.crowdsec.active-bans" />}
				value={formatCount(activeBans)}
				hint={
					<span className={bansAdded24h > 0 ? "font-medium text-destructive" : undefined}>
						<T id="dashboard.monitoring.bans-added" data={{ count: formatCount(bansAdded24h ?? 0) }} />
					</span>
				}
			>
				<CardPicture>{reasons.length > 0 ? <BanReasons segments={reasons} /> : null}</CardPicture>
			</StatCard>
		) : null,
		countries.length > 0 ? (
			<StatCard
				key="country"
				to="/monitoring/traffic"
				icon={FlagIcon}
				tone="primary"
				label={<T id="dashboard.monitoring.top-countries" />}
				value={
					<>
						<Flag countryCode={countries[0].code} className="me-2 align-[-0.1em]" tooltip={false} />
						{countryLabel(countries[0].code)}
					</>
				}
				hint={<T id="monitoring.requests" data={{ count: countries[0].requests }} />}
			>
				<CardPicture>{countries.length > 1 ? <TopCountries rows={countries.slice(1)} /> : null}</CardPicture>
			</StatCard>
		) : null,
	].filter(Boolean);

	if (cards.length === 0) return null;
	return <div className={cn("grid gap-4", GRID_BY_COUNT[cards.length])}>{cards}</div>;
}

export { MonitoringRow };
