import {
	IconAlertTriangle,
	IconArrowsTransferDown,
	IconChartBar,
	IconChartLine,
	IconListDetails,
	IconUsers,
	IconWorld,
	IconWorldOff,
} from "@tabler/icons-react";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { ErrorAlert, ListToolbar, Loading, NoticeAlert } from "src/components";
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
	errorRateColor,
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
	statusColor,
} from "src/modules/Monitoring";

const DEFAULT_RANGE = "24h";
const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

const BADGES = {
	proxy: { color: "green", labelKey: "monitoring.host.badge.proxy" },
	redirection: { color: "yellow", labelKey: "monitoring.host.badge.redirection" },
	dead: { color: "red", labelKey: "monitoring.host.badge.dead" },
	deleted: { color: "secondary", labelKey: "monitoring.host.badge.deleted" },
};

// recent requests shown before "Show all" (the API sends up to 100); fewer on phones, where rows are stacked
const FIRST_ROWS = 25;
const FIRST_ROWS_SMALL = 10;
// Tabler's md breakpoint
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

	return (
		<div className="d-flex flex-wrap align-items-center gap-2 mb-3">
			<fieldset className="btn-group" aria-label={intl.formatMessage({ id: "monitoring.range" })}>
				{rangeOptions.map((option) => (
					<Fragment key={option.value}>
						<input
							type="radio"
							className="btn-check"
							name="monitoring-range"
							id={`monitoring-range-${option.value}`}
							checked={range === option.value}
							onChange={() => onRange(option.value)}
						/>
						<label className="btn" htmlFor={`monitoring-range-${option.value}`}>
							<T id={option.labelKey} />
						</label>
					</Fragment>
				))}
			</fieldset>
			<select
				className="form-select w-auto mw-100"
				aria-label={intl.formatMessage({ id: "monitoring.host" })}
				value={value}
				onChange={(e) => onFilter(hostFilterFromSelect(e.target.value))}
			>
				<option value="">{intl.formatMessage({ id: "monitoring.host.all" })}</option>
				<option value={OTHER_HOST}>{intl.formatMessage({ id: "monitoring.host.other" })}</option>
				{known ? null : <option value={value}>{unknownFilterLabel(filter)}</option>}
				{groups
					.filter((group) => group.options.length > 0)
					.map((group) => (
						<optgroup key={group.type} label={intl.formatMessage({ id: group.labelKey })}>
							{group.options.map((option) => (
								<option key={option.value} value={option.value} title={option.domainNames.join(", ")}>
									{optionText(option)}
								</option>
							))}
						</optgroup>
					))}
			</select>
		</div>
	);
}

function StatusLine({ status }) {
	return (
		<div className="text-secondary small mt-3">
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
	const className = "col-6 col-lg";
	if (!status.uniqueVisitors) {
		return (
			<StatCard
				className={className}
				to="/settings/monitoring"
				label={<T id="monitoring.stat.visitors" />}
				value={<T id="monitoring.stat.visitors.off" />}
				hint={<T id="monitoring.stat.visitors.off.hint" />}
				icon={IconUsers}
				color="secondary"
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
			className={className}
			label={<T id="monitoring.stat.visitors" />}
			value={`${formatCount(visitors)}${totals.visitorsCapped ? "+" : ""}`}
			hint={hint}
			icon={IconUsers}
			color="purple"
		/>
	);
}

function HostBadge({ badge }) {
	if (!badge) return null;
	return (
		<span className={`badge bg-${BADGES[badge].color}-lt`}>
			<T id={BADGES[badge].labelKey} />
		</span>
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
				cell: (info) => <span className="text-nowrap">{formatDateTime(info.getValue())}</span>,
			}),
			columnHelper.accessor(recentHostName, {
				id: "host",
				header: intl.formatMessage({ id: "monitoring.recent.column.host" }),
				enableSorting: false,
				cell: (info) => (
					<span className="d-inline-flex flex-wrap align-items-center gap-2">
						<span className="text-break">{info.getValue()}</span>
						<HostBadge badge={hostEntryLabel(info.row.original).badge} />
					</span>
				),
			}),
			columnHelper.accessor("path", {
				header: intl.formatMessage({ id: "monitoring.recent.column.request" }),
				enableSorting: false,
				cell: (info) => {
					const { method, path } = info.row.original;
					if (method === "-" && path === "") return <span className="text-secondary">-</span>;
					return (
						<span className="font-monospace text-break">
							<span className="text-secondary me-2">{method}</span>
							{path}
						</span>
					);
				},
			}),
			columnHelper.accessor("status", {
				header: intl.formatMessage({ id: "monitoring.recent.column.status" }),
				enableSorting: false,
				cell: (info) => (
					<span className={`badge bg-${statusColor(info.getValue())}-lt`}>{info.getValue()}</span>
				),
			}),
			columnHelper.accessor("bytes", {
				header: intl.formatMessage({ id: "monitoring.recent.column.size" }),
				enableSorting: false,
				cell: (info) => <span className="text-nowrap">{formatBytes(info.getValue())}</span>,
			}),
			columnHelper.accessor((row) => (row.country ? countryLabel(row.country) : ""), {
				id: "country",
				header: intl.formatMessage({ id: "monitoring.recent.column.country" }),
				enableSorting: false,
				cell: (info) =>
					info.row.original.country ? (
						<CountryName code={info.row.original.country} />
					) : (
						<span className="text-secondary">-</span>
					),
			}),
			...(withIps
				? [
						columnHelper.accessor("ip", {
							header: intl.formatMessage({ id: "monitoring.recent.column.ip" }),
							enableSorting: false,
							cell: (info) => <span className="font-monospace text-break">{info.getValue() ?? "-"}</span>,
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
		<div className="col-12">
			<div className="card">
				<div className="card-table">
					<div className="card-header">
						<div>
							<h3 className="card-title">
								<T id="monitoring.recent" />
							</h3>
							<p className="card-subtitle">
								<T id="monitoring.recent.subtitle" />
							</p>
						</div>
					</div>
					{rows.length === 0 ? (
						<div className="card-body">
							<EmptyState icon={IconListDetails} title={<T id="monitoring.recent.empty" />} />
						</div>
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
							<TableLayout tableInstance={tableInstance} />
						</>
					)}
				</div>
				{visible.length < displayed.length ? (
					<div className="card-footer text-center">
						<button type="button" className="btn btn-link" onClick={() => setShowAll(true)}>
							<T id="monitoring.recent.show-all" data={{ count: displayed.length }} />
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

function TrafficData({ data, range, params }) {
	const { status, totals } = data;
	const geoip = status.geoip;
	const topCountry = data.topCountries.find((c) => isCountryCode(c.country));
	const empty = <T id="monitoring.no-data" />;

	return (
		<>
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
			<div className="row row-deck row-cards">
				<StatCard
					className="col-6 col-lg"
					label={<T id="monitoring.stat.requests" />}
					value={formatCount(totals.requests)}
					hint={exactHint(totals.requests)}
					icon={IconChartBar}
					color="primary"
				/>
				<StatCard
					className="col-6 col-lg"
					label={<T id="monitoring.stat.data-sent" />}
					value={formatBytes(totals.bytes)}
					icon={IconArrowsTransferDown}
					color="azure"
				/>
				<StatCard
					className="col-6 col-lg"
					label={<T id="monitoring.stat.error-rate" />}
					value={percentFormat.format(totals.errorRate)}
					hint={<T id="monitoring.stat.error-rate.hint" />}
					icon={IconAlertTriangle}
					color={errorRateColor(totals.errorRate)}
				/>
				<StatCard
					className="col-6 col-lg"
					label={<T id="monitoring.stat.top-country" />}
					value={
						topCountry ? (
							// smaller than the other values so a country name fits one of five cards
							<span className="fs-3" title={countryLabel(topCountry.country)}>
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
					icon={IconWorld}
					color="green"
				/>
				<VisitorsCard status={status} totals={totals} range={range} />
				<div className="col-12">
					<div className="card">
						<div className="card-header">
							<h3 className="card-title">
								<T id="monitoring.traffic.requests-over-time" />
							</h3>
						</div>
						<div className="card-body">
							<TrafficChart series={data.series} range={range} />
						</div>
					</div>
				</div>
				{geoip ? (
					<>
						<div className="col-lg-8">
							<div className="card">
								<div className="card-header">
									<h3 className="card-title">
										<T id="monitoring.traffic.map" />
									</h3>
								</div>
								<div className="card-body">
									<WorldMap
										countries={data.countries}
										label={intl.formatMessage({ id: "monitoring.traffic.map" })}
									/>
								</div>
							</div>
						</div>
						<TopList
							className="col-lg-4"
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
					</>
				) : (
					<div className="col-12">
						<div className="card">
							<div className="card-body">
								<EmptyState
									icon={IconWorldOff}
									title={<T id="monitoring.geoip.missing" />}
									subtitle={<T id="monitoring.geoip.missing.subtitle" />}
									to="/settings/geoip"
									action={<T id="monitoring.geoip.setup" />}
								/>
							</div>
						</div>
					</div>
				)}
				<TopList
					title={<T id="monitoring.top.hosts" />}
					total={totals.requests}
					empty={empty}
					items={data.topHosts.map((entry) =>
						topHostItem(entry, { uniqueVisitors: status.uniqueVisitors, params }),
					)}
				/>
				{geoip ? (
					<TopList
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
						title={<T id="monitoring.top.ips" />}
						total={totals.requests}
						empty={empty}
						items={data.topIps.map((i) => {
							const name = i.ip === "other" ? intl.formatMessage({ id: "monitoring.ip.other" }) : i.ip;
							return {
								key: i.ip,
								label: <span className="font-monospace">{name}</span>,
								title: name,
								value: i.requests,
							};
						})}
					/>
				) : null}
				<RecentTable rows={data.recent ?? []} />
			</div>
			<StatusLine status={status} />
		</>
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
			<div className="card">
				<div className="card-body">
					<EmptyState
						icon={IconChartLine}
						title={<T id="monitoring.traffic.off" />}
						subtitle={<T id="monitoring.traffic.off.subtitle" />}
						to="/settings/monitoring"
						action={<T id="monitoring.traffic.enable" />}
					/>
				</div>
			</div>
		);
	}

	return (
		<>
			{data?.status.enabled === false ? null : (
				<Toolbar range={range} filter={filter} onRange={onRange} onFilter={onFilter} />
			)}
			{content}
		</>
	);
};

export default Traffic;
