import {
	ArrowDownUpIcon,
	ChartColumnIcon,
	ChartLineIcon,
	GlobeIcon,
	GlobeLockIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { ErrorAlert, Loading, NoticeAlert } from "src/components";
import {
	CountryName,
	countryLabel,
	EmptyState,
	StatCard,
	TopList,
	TrafficChart,
	WorldMap,
} from "src/components/Monitoring";
import { Card, CardContent, CardHeader, CardTitle } from "src/components/ui/card";
import { useMonitoringTraffic } from "src/hooks";
import { currentLocale, intl, T } from "src/locale";
import {
	errorRateTone,
	formatBytes,
	formatCount,
	hostEntryLabel,
	hostFilterFromSearch,
	hostFilterToSearch,
	isCountryCode,
	rangeOptions,
} from "src/modules/Monitoring";
import { exactHint, StatusLine, VisitorsCard } from "./TrafficCards";
import { HostBadge, RecentTable } from "./TrafficRecent";
import { extraText, Toolbar } from "./TrafficToolbar";

const DEFAULT_RANGE = "24h";
const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

/**
 * Top hosts row: first domain name, "+N" for more names (all in the tooltip), a type badge, the visitors when they
 * are counted, and a link to the filtered view for a host that still exists.
 */
const topHostItem = (entry, { uniqueVisitors, params }) => {
	const { name, extra, badge } = hostEntryLabel(entry);
	const isOther = entry.hostType === "other";
	const label = isOther ? intl.formatMessage({ id: "monitoring.host.other" }) : name;
	const names = entry.domainNames?.length ? entry.domainNames.join(", ") : label;
	const linkable = badge && badge !== "deleted" && entry.hostId;
	let detail = null;
	let visitorsText = "";
	if (uniqueVisitors && entry.visitors !== undefined) {
		visitorsText = intl.formatMessage(
			{ id: entry.visitorsCapped ? "monitoring.visitors.capped" : "monitoring.visitors" },
			{ count: entry.visitors },
		);
		detail = (
			<T
				id={entry.visitorsCapped ? "monitoring.visitors.capped" : "monitoring.visitors"}
				data={{ count: entry.visitors }}
			/>
		);
	}
	return {
		key: `${entry.hostType}:${entry.hostId ?? entry.name}`,
		label,
		title: names,
		extra: extraText(extra),
		badge: badge ? <HostBadge badge={badge} /> : null,
		detail,
		value: entry.requests,
		ariaLabel: linkable
			? [label, intl.formatMessage({ id: "monitoring.requests" }, { count: entry.requests }), visitorsText]
					.filter(Boolean)
					.join(", ")
			: undefined,
		to: linkable
			? `/monitoring/traffic?${hostFilterToSearch({ hostType: entry.hostType, hostId: entry.hostId }, params)}`
			: undefined,
	};
};

function TrafficData({ data, range, params }) {
	const { status, totals } = data;
	const geoip = status.geoip;
	const topCountry = data.topCountries.find((c) => isCountryCode(c.country));
	const empty = <T id="monitoring.no-data" />;

	// the grids follow the width of this container, not the viewport, so the sidebar layout gets fewer columns
	return (
		<div className="@container flex flex-col gap-4">
			{status.error ? (
				<NoticeAlert>
					<T id="monitoring.traffic.read-error" data={{ error: status.error }} />
				</NoticeAlert>
			) : null}
			{status.uniqueVisitors && status.visitorsError ? (
				<NoticeAlert>
					<T id="monitoring.traffic.visitors-error" data={{ error: status.visitorsError }} />
				</NoticeAlert>
			) : null}
			<div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-5">
				<StatCard
					className="min-w-0"
					label={<T id="monitoring.stat.requests" />}
					value={formatCount(totals.requests)}
					hint={exactHint(totals.requests)}
					icon={ChartColumnIcon}
					tone="primary"
				/>
				<StatCard
					className="min-w-0"
					label={<T id="monitoring.stat.data-sent" />}
					value={formatBytes(totals.bytes)}
					icon={ArrowDownUpIcon}
					tone="info"
				/>
				<StatCard
					className="min-w-0"
					label={<T id="monitoring.stat.error-rate" />}
					value={percentFormat.format(totals.errorRate)}
					hint={<T id="monitoring.stat.error-rate.hint" />}
					icon={TriangleAlertIcon}
					tone={errorRateTone(totals.errorRate)}
				/>
				<VisitorsCard status={status} totals={totals} range={range} />
				<StatCard
					// the last of five cards: a full row on two columns, one of five on a wide container
					className="min-w-0 @lg:col-span-2 @4xl:col-span-1"
					label={<T id="monitoring.stat.top-country" />}
					value={
						topCountry ? (
							// smaller than the other values so a country name fits one of five cards
							<span className="text-xl">
								<CountryName code={topCountry.country} />
							</span>
						) : (
							"-"
						)
					}
					hint={
						topCountry ? (
							<T id="monitoring.requests" data={{ count: topCountry.requests }} />
						) : (
							<T id={geoip ? "monitoring.no-data" : "monitoring.geoip.missing"} />
						)
					}
					icon={GlobeIcon}
					tone="success"
				/>
			</div>
			<Card>
				<CardHeader>
					<CardTitle role="heading" aria-level={2}>
						<T id="monitoring.traffic.requests-over-time" />
					</CardTitle>
				</CardHeader>
				<CardContent>
					<TrafficChart series={data.series} range={range} />
				</CardContent>
			</Card>
			{geoip ? (
				<div className="grid gap-4 @4xl:grid-cols-3">
					<Card className="min-w-0 @4xl:col-span-2">
						<CardHeader>
							<CardTitle role="heading" aria-level={2}>
								<T id="monitoring.traffic.map" />
							</CardTitle>
						</CardHeader>
						<CardContent>
							<WorldMap
								countries={data.countries}
								label={intl.formatMessage({ id: "monitoring.traffic.map" })}
							/>
						</CardContent>
					</Card>
					<TopList
						className="min-w-0"
						title={<T id="monitoring.top.countries" />}
						total={totals.requests}
						empty={empty}
						items={data.topCountries.map((c) => ({
							key: c.country,
							label: <CountryName code={c.country} />,
							title: countryLabel(c.country),
							tip: false,
							value: c.requests,
						}))}
					/>
				</div>
			) : (
				<Card>
					<CardContent>
						<EmptyState
							icon={GlobeLockIcon}
							title={<T id="monitoring.geoip.missing" />}
							subtitle={<T id="monitoring.geoip.missing.subtitle" />}
							to="/settings/geoip"
							action={<T id="monitoring.geoip.setup" />}
						/>
					</CardContent>
				</Card>
			)}
			<div className="grid gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3">
				<TopList
					className="min-w-0"
					title={<T id="monitoring.top.hosts" />}
					total={totals.requests}
					empty={empty}
					items={data.topHosts.map((entry) =>
						topHostItem(entry, { uniqueVisitors: status.uniqueVisitors, params }),
					)}
				/>
				{geoip ? (
					<TopList
						className="min-w-0"
						title={<T id="monitoring.top.networks" />}
						total={totals.requests}
						empty={empty}
						items={data.topAsns.map((a) => {
							const name =
								a.asn === 0
									? intl.formatMessage({ id: "monitoring.network.other" })
									: `AS${a.asn} ${a.asnName}`.trim();
							return { key: String(a.asn), label: name, title: name, value: a.requests };
						})}
					/>
				) : null}
				{data.topIps ? (
					<TopList
						className="min-w-0"
						title={<T id="monitoring.top.ips" />}
						total={totals.requests}
						empty={empty}
						items={data.topIps.map((i) => {
							const name = i.ip === "other" ? intl.formatMessage({ id: "monitoring.ip.other" }) : i.ip;
							return {
								key: i.ip,
								label: <span className="font-mono">{name}</span>,
								title: name,
								value: i.requests,
							};
						})}
					/>
				) : null}
				<RecentTable rows={data.recent ?? []} />
			</div>
			<StatusLine status={status} />
		</div>
	);
}

const Traffic = () => {
	const [params, setParams] = useSearchParams();
	const range = rangeOptions.some((o) => o.value === params.get("range")) ? params.get("range") : DEFAULT_RANGE;
	const filter = hostFilterFromSearch(params);
	const { data, error, isPending, isPlaceholderData } = useMonitoringTraffic(range, filter);

	const onRange = (value) =>
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				if (value === DEFAULT_RANGE) next.delete("range");
				else next.set("range", value);
				return next;
			},
			{ replace: true },
		);
	// a host selection is a new history entry, so Back returns to the previous host
	const onFilter = (next) => setParams((prev) => hostFilterToSearch(next, prev));

	let content;
	if (isPending) {
		content = <Loading noLogo delay={300} />;
	} else if (error && !data) {
		content = <ErrorAlert error={error} />;
	} else if (data.status.enabled) {
		// the previous range or host stays visible, dimmed, until the new data is there
		content = (
			<div className={isPlaceholderData ? "opacity-50" : undefined} aria-busy={isPlaceholderData}>
				<TrafficData data={data} range={range} params={params} />
			</div>
		);
	} else {
		content = (
			<Card>
				<CardContent>
					<EmptyState
						icon={ChartLineIcon}
						title={<T id="monitoring.traffic.off" />}
						subtitle={<T id="monitoring.traffic.off.subtitle" />}
						to="/settings/monitoring"
						action={<T id="monitoring.traffic.enable" />}
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{data?.status.enabled === false ? null : (
				<Toolbar range={range} filter={filter} onRange={onRange} onFilter={onFilter} />
			)}
			{content}
		</div>
	);
};

export default Traffic;
