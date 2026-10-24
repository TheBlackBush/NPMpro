import { IconAlertTriangle, IconFlag, IconGauge, IconShieldLock } from "@tabler/icons-react";
import { CountryName } from "src/components/Monitoring/CountryName";
import { StatCard } from "src/components/Monitoring/StatCard";
import { useMonitoringSummary } from "src/hooks/useMonitoring";
import { currentLocale, intl, T } from "src/locale";
import { errorRateColor, formatCount, isCountryCode, sparklinePoints } from "src/modules/Monitoring";

const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

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
			className="text-primary mt-2 d-block w-100"
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			height={HEIGHT}
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
 * Row of four monitoring cards above the dashboard tiles. Each card is hidden when its value is unknown.
 * Only rendered for administrators (the summary endpoint is admin only).
 */
function MonitoringRow() {
	const { data } = useMonitoringSummary();
	if (!data) return null;

	const { requestsToday, series24h, errorRateToday, activeBans, topCountryToday } = data;
	const hasCountry = isCountryCode(topCountryToday);
	const cards = [
		requestsToday !== null && requestsToday !== undefined ? (
			<StatCard
				className="col-6 col-lg-3"
				key="requests"
				to="/monitoring/traffic"
				icon={IconGauge}
				color="blue"
				label={<T id="dashboard.monitoring.requests" />}
				value={formatCount(requestsToday)}
			>
				{series24h?.length > 1 ? <Sparkline series={series24h} /> : null}
			</StatCard>
		) : null,
		errorRateToday !== null && errorRateToday !== undefined ? (
			<StatCard
				className="col-6 col-lg-3"
				key="errors"
				to="/monitoring/traffic"
				icon={IconAlertTriangle}
				color={errorRateColor(errorRateToday)}
				label={<T id="dashboard.monitoring.error-rate" />}
				value={percentFormat.format(errorRateToday)}
				hint={<T id="monitoring.stat.error-rate.hint" />}
			/>
		) : null,
		activeBans !== null && activeBans !== undefined ? (
			<StatCard
				className="col-6 col-lg-3"
				key="bans"
				to="/monitoring/crowdsec"
				icon={IconShieldLock}
				color="red"
				label={<T id="monitoring.crowdsec.active-bans" />}
				value={formatCount(activeBans)}
			/>
		) : null,
		hasCountry ? (
			<StatCard
				className="col-6 col-lg-3"
				key="country"
				to="/monitoring/traffic"
				icon={IconFlag}
				color="teal"
				label={<T id="dashboard.monitoring.top-country" />}
				value={<CountryName code={topCountryToday} />}
			/>
		) : null,
	].filter(Boolean);

	return cards;
}

export { MonitoringRow };
