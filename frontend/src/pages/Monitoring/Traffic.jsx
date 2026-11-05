import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import {
	ArrowDownUpIcon,
	ChartColumnIcon,
	ChartLineIcon,
	GlobeIcon,
	GlobeLockIcon,
	ListIcon,
	TriangleAlertIcon,
	UsersIcon,
} from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { BreakableHost, ErrorAlert, ListToolbar, Loading, NoticeAlert, StatusBadge } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import {
	CountryName,
	countryLabel,
	EmptyState,
	StatCard,
	TopList,
	TrafficChart,
	WorldMap,
} from "src/components/Monitoring";
import { TableLayout } from "src/components/Table/TableLayout";
import { TapTooltip } from "src/components/TapTooltip";
import { Button } from "src/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "src/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "src/components/ui/toggle-group";
import {
	useDeadHosts,
	useListFilters,
	useMonitoringSettings,
	useMonitoringTraffic,
	useProxyHosts,
	useRedirectionHosts,
} from "src/hooks";
import { currentLocale, formatDateTime, intl, T } from "src/locale";
import {
	errorRateTone,
	filterRecent,
	formatBytes,
	formatCount,
	hostEntryLabel,
	hostFilterFromSearch,
	hostFilterFromSelect,
	hostFilterToSearch,
	hostGroups,
	hostSelectValue,
	isCountryCode,
	OTHER_HOST,
	rangeOptions,
	statusTone,
} from "src/modules/Monitoring";

const DEFAULT_RANGE = "24h";
const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

const BADGES = {
	proxy: { tone: "success", labelKey: "monitoring.host.badge.proxy" },
	redirection: { tone: "warning", labelKey: "monitoring.host.badge.redirection" },
	dead: { tone: "destructive", labelKey: "monitoring.host.badge.dead" },
	deleted: { tone: "muted", labelKey: "monitoring.host.badge.deleted" },
};

// recent requests shown before "Show all" (the API sends up to 100); fewer on phones, where rows are stacked
const FIRST_ROWS = 25;
const FIRST_ROWS_SMALL = 10;
// the md breakpoint
const MD_UP = "(min-width: 768px)";

const subscribeMdUp = (onChange) => {
	const query = window.matchMedia(MD_UP);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
};
const isMdUp = () => window.matchMedia(MD_UP).matches;

// newest first, as the API sends them; no column sorting, like the newest bans table
const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper();

/**
 * The exact number as a hint under a short value ("5.9k" over "5,948"), nothing when both read the same.
 */
const exactHint = (n) => {
	const exact = intl.formatNumber(Number(n) || 0);
	return exact === formatCount(n) ? undefined : exact;
};

const extraText = (count) => (count > 0 ? intl.formatMessage({ id: "monitoring.host.extra" }, { count }) : "");

const optionText = (option) => [option.label, extraText(option.extra)].filter(Boolean).join(" ");

/**
 * Label of a filter that is not in the host lists (a host from the URL that is gone, or an old host key), so the
 * select still shows what is filtered.
 */
const unknownFilterLabel = (filter) =>
	filter.host ?? intl.formatMessage({ id: "monitoring.host.unknown" }, { id: filter.hostId });

function Toolbar({ range, filter, onRange, onFilter }) {
	const { data: proxy } = useProxyHosts();
	const { data: redirection } = useRedirectionHosts();
	const { data: dead } = useDeadHosts();
	const groups = hostGroups({ proxy, redirection, dead });
	const value = hostSelectValue(filter);
	const known = value === "" || value === OTHER_HOST || groups.some((g) => g.options.some((o) => o.value === value));

	const options = [
		{ value: "", label: intl.formatMessage({ id: "monitoring.host.all" }) },
		{ value: OTHER_HOST, label: intl.formatMessage({ id: "monitoring.host.other" }) },
		...(known ? [] : [{ value, label: unknownFilterLabel(filter) }]),
		...groups
			.filter((group) => group.options.length > 0)
			.map((group) => ({
				key: group.type,
				label: intl.formatMessage({ id: group.labelKey }),
				options: group.options.map((option) => ({ value: option.value, label: optionText(option) })),
			})),
	];

	return (
		<div className="flex flex-wrap items-center gap-2">
			<ToggleGroup
				type="single"
				variant="outline"
				spacing={0}
				value={range}
				// an empty value is the chosen item pressed again: one range is always chosen
				onValueChange={(next) => next && onRange(next)}
				aria-label={intl.formatMessage({ id: "monitoring.range" })}
			>
				{rangeOptions.map((option) => (
					<ToggleGroupItem key={option.value} value={option.value}>
						<T id={option.labelKey} />
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<AppSelect
				className="w-auto max-w-full"
				aria-label={intl.formatMessage({ id: "monitoring.host" })}
				value={value}
				onValueChange={(next) => onFilter(hostFilterFromSelect(next))}
				options={options}
			/>
		</div>
	);
}

function StatusLine({ status }) {
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

function VisitorsCard({ status, totals, range }) {
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

function HostBadge({ badge }) {
	if (!badge) return null;
	return (
		<StatusBadge tone={BADGES[badge].tone} dot={false}>
			<T id={BADGES[badge].labelKey} />
		</StatusBadge>
	);
}

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

/** Shown host of a recent request: "Other hosts" for _other, otherwise the first domain name. */
const recentHostName = (row) =>
	row.hostType === "other" ? intl.formatMessage({ id: "monitoring.host.other" }) : hostEntryLabel(row).name;

/**
 * The newest requests the backend keeps in memory (the selected host's or all), like "Newest bans": search, the
 * first 25 rows (10 below the md breakpoint) with "Show all", the IP column only when the API sends IPs.
 */
function RecentTable({ rows }) {
	const { filters, setFilter, clear } = useListFilters();
	const [showAll, setShowAll] = useState(false);
	const mdUp = useSyncExternalStore(subscribeMdUp, isMdUp);
	const withIps = rows.some((row) => row.ip !== undefined);
	const displayed = filterRecent(rows, filters.q, { hostOf: recentHostName, nameOf: countryLabel });
	const visible = showAll ? displayed : displayed.slice(0, mdUp ? FIRST_ROWS : FIRST_ROWS_SMALL);

	const columns = useMemo(
		() => [
			columnHelper.accessor("time", {
				header: intl.formatMessage({ id: "monitoring.recent.column.time" }),
				enableSorting: false,
				cell: (info) => <span className="whitespace-nowrap">{formatDateTime(info.getValue())}</span>,
			}),
			columnHelper.accessor(recentHostName, {
				id: "host",
				header: intl.formatMessage({ id: "monitoring.recent.column.host" }),
				enableSorting: false,
				cell: (info) => (
					<span className="inline-flex flex-wrap items-center gap-2">
						<span>
							<BreakableHost value={info.getValue()} />
						</span>
						<HostBadge badge={hostEntryLabel(info.row.original).badge} />
					</span>
				),
				// a long host name wraps at its dots, so the request column keeps room on tablets
				meta: { className: "whitespace-normal" },
			}),
			columnHelper.accessor("path", {
				header: intl.formatMessage({ id: "monitoring.recent.column.request" }),
				enableSorting: false,
				cell: (info) => {
					const { method, path } = info.row.original;
					if (method === "-" && path === "") return <span className="text-muted-foreground">-</span>;
					return (
						// hover, focus (Tab) or a tap shows the whole path
						<TapTooltip content={`${method} ${path}`}>
							<span className="block truncate font-mono">
								<span className="me-2 text-muted-foreground">{method}</span>
								{path}
							</span>
						</TapTooltip>
					);
				},
			}),
			columnHelper.accessor("status", {
				header: intl.formatMessage({ id: "monitoring.recent.column.status" }),
				enableSorting: false,
				cell: (info) => (
					<StatusBadge tone={statusTone(info.getValue())} dot={false}>
						{info.getValue()}
					</StatusBadge>
				),
			}),
			columnHelper.accessor("bytes", {
				header: intl.formatMessage({ id: "monitoring.recent.column.size" }),
				enableSorting: false,
				cell: (info) => <span className="whitespace-nowrap">{formatBytes(info.getValue())}</span>,
				meta: { mobile: "hide" },
			}),
			columnHelper.accessor((row) => (row.country ? countryLabel(row.country) : ""), {
				id: "country",
				header: intl.formatMessage({ id: "monitoring.recent.column.country" }),
				enableSorting: false,
				cell: (info) =>
					info.row.original.country ? (
						<CountryName code={info.row.original.country} />
					) : (
						<span className="text-muted-foreground">-</span>
					),
				meta: { mobile: "hide" },
			}),
			...(withIps
				? [
						columnHelper.accessor("ip", {
							header: intl.formatMessage({ id: "monitoring.recent.column.ip" }),
							enableSorting: false,
							cell: (info) => <span className="font-mono break-all">{info.getValue() ?? "-"}</span>,
						}),
					]
				: []),
		],
		[withIps],
	);

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data: visible,
		// time, host and path can repeat within a second: the position in the newest first list is the id
		getRowId: (_row, index) => String(index),
	});

	return (
		<Card className="min-w-0 gap-0 py-0 @2xl:col-span-2 @6xl:col-span-3">
			<CardHeader className="py-(--card-spacing)">
				<CardTitle role="heading" aria-level={2}>
					<T id="monitoring.recent" />
				</CardTitle>
				<CardDescription>
					<T id="monitoring.recent.subtitle" />
				</CardDescription>
			</CardHeader>
			{rows.length === 0 ? (
				<CardContent className="pb-(--card-spacing)">
					<EmptyState icon={ListIcon} title={<T id="monitoring.recent.empty" />} />
				</CardContent>
			) : (
				<>
					<ListToolbar
						filters={filters}
						setFilter={setFilter}
						clear={clear}
						total={rows.length}
						shown={displayed.length}
						kinds={[]}
					/>
					<TableLayout
						tableInstance={tableInstance}
						layout="scroll"
						label={intl.formatMessage({ id: "monitoring.recent" })}
					/>
				</>
			)}
			{visible.length < displayed.length ? (
				<CardFooter className="justify-center border-t">
					<Button type="button" variant="link" onClick={() => setShowAll(true)}>
						<T id="monitoring.recent.show-all" data={{ count: displayed.length }} />
					</Button>
				</CardFooter>
			) : null}
		</Card>
	);
}

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
