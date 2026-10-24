import {
	IconClockPlus,
	IconPlugConnected,
	IconPlugConnectedX,
	IconShieldCheck,
	IconShieldOff,
	IconShieldX,
} from "@tabler/icons-react";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { ErrorAlert, ListToolbar, Loading, NoticeAlert } from "src/components";
import { CountryName, countryLabel, EmptyState, StatCard, TopList, WorldMap } from "src/components/Monitoring";
import { TableLayout } from "src/components/Table/TableLayout";
import { useListFilters, useMonitoringCrowdsec } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { filterBans, formatCount, secondsLeftNow, timeLeftParts } from "src/modules/Monitoring";

const README_CROWDSEC = "https://github.com/TheBlackBush/NPMpro#crowdsec";

// newest first, as the API sends them; no column sorting, since only the first rows are shown until "Show all"
const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
});

// rows shown before "Show all"; 100 stacked rows make a very long page on a phone
const FIRST_ROWS = 25;

// the time left counts down between polls; a ban list kept after a failed poll keeps counting too
const TICK_MS = 30 * 1000;

const columnHelper = createColumnHelper();

// "3h 59m" in English; the unit strings come from the translations
const formatTimeLeft = (seconds) => {
	const parts = timeLeftParts(seconds);
	if (parts.length === 0) return intl.formatMessage({ id: "monitoring.crowdsec.time-left.less-than-minute" });
	return parts
		.map((p) => intl.formatMessage({ id: `monitoring.crowdsec.time-left.${p.unit}` }, { count: p.count }))
		.join(" ");
};

const TYPE_BADGE = { ban: "bg-red-lt", captcha: "bg-orange-lt" };

// "crowdsecurity/http-probing": the hub author muted, the scenario name as is; "manual" and others stay plain
function Scenario({ name }) {
	const slash = name.indexOf("/");
	if (slash <= 0) return <span>{name}</span>;
	return (
		<span>
			<span className="text-secondary">{name.slice(0, slash + 1)}</span>
			{name.slice(slash + 1)}
		</span>
	);
}

function TypeBadge({ type }) {
	return <span className={`badge ${TYPE_BADGE[type] ?? "bg-secondary-lt"}`}>{type}</span>;
}

function Connection({ data }) {
	if (data.reachable) {
		return (
			<span className="status status-green">
				<span className="status-dot status-dot-animated" />
				<T id="monitoring.crowdsec.connected" />
			</span>
		);
	}
	return (
		<span className="status status-red">
			<span className="status-dot" />
			<T id="monitoring.crowdsec.unreachable" />
		</span>
	);
}

function BansTable({ data }) {
	const { filters, setFilter, clear } = useListFilters();
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, []);
	const rows = useMemo(
		() => data.newest.map((row) => ({ ...row, left: secondsLeftNow(row.secondsLeft, data.fetchedAt, now) })),
		[data.newest, data.fetchedAt, now],
	);
	const [showAll, setShowAll] = useState(false);
	const displayed = filterBans(rows, filters.q, countryLabel);
	const visible = showAll ? displayed : displayed.slice(0, FIRST_ROWS);

	const columns = useMemo(
		() => [
			columnHelper.accessor("value", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.value" }),
				enableSorting: false,
				cell: (info) => <span className="font-monospace text-break">{info.getValue()}</span>,
			}),
			columnHelper.accessor("scenario", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.reason" }),
				enableSorting: false,
				cell: (info) => <Scenario name={info.getValue()} />,
			}),
			columnHelper.accessor("origin", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.origin" }),
				enableSorting: false,
				cell: (info) => <span className="text-break">{info.getValue()}</span>,
			}),
			columnHelper.accessor("type", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.type" }),
				enableSorting: false,
				cell: (info) => <TypeBadge type={info.getValue()} />,
			}),
			columnHelper.accessor("left", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.time-left" }),
				enableSorting: false,
				cell: (info) => (
					<span className="text-nowrap" title={info.row.original.duration}>
						{formatTimeLeft(info.getValue())}
					</span>
				),
			}),
			columnHelper.accessor((row) => countryLabel(row.country), {
				id: "country",
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.country" }),
				enableSorting: false,
				cell: (info) => <CountryName code={info.row.original.country} />,
			}),
		],
		[],
	);

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data: visible,
		getRowId: (row) => `${row.id}`,
	});

	return (
		<div className="col-12">
			<div className="card">
				<div className="card-table">
					<div className="card-header">
						<div>
							<h3 className="card-title">
								<T id="monitoring.crowdsec.newest" />
							</h3>
							{data.total > rows.length ? (
								<p className="card-subtitle">
									<T
										id="monitoring.crowdsec.newest.subtitle"
										data={{ shown: rows.length, total: data.total }}
									/>
								</p>
							) : null}
						</div>
					</div>
					<ListToolbar
						filters={filters}
						setFilter={setFilter}
						clear={clear}
						total={rows.length}
						shown={displayed.length}
						kinds={[]}
					/>
					<TableLayout tableInstance={tableInstance} />
				</div>
				{visible.length < displayed.length ? (
					<div className="card-footer text-center">
						<button type="button" className="btn btn-link" onClick={() => setShowAll(true)}>
							<T id="monitoring.crowdsec.show-all" data={{ count: displayed.length }} />
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

function CrowdsecData({ data }) {
	const noBans = <T id="monitoring.crowdsec.no-bans" />;
	const types = data.byType.map((t) => `${intl.formatNumber(t.count)} ${t.type}`).join(" · ");

	return (
		<>
			{data.reachable ? null : (
				<NoticeAlert>
					<T
						id="monitoring.crowdsec.stale"
						data={{ error: data.error ?? "", time: formatDateTime(data.fetchedAt) }}
					/>
				</NoticeAlert>
			)}
			<div className="row row-deck row-cards">
				<StatCard
					className="col-md-4"
					label={<T id="monitoring.crowdsec.active-bans" />}
					value={formatCount(data.total)}
					hint={types || undefined}
					icon={IconShieldX}
					color="red"
				/>
				<StatCard
					className="col-md-4"
					label={<T id="monitoring.crowdsec.added-24h" />}
					value={formatCount(data.added24h)}
					hint={<T id="monitoring.crowdsec.added-24h.hint" />}
					icon={IconClockPlus}
					color="orange"
				/>
				<StatCard
					className="col-md-4"
					label={<T id="monitoring.crowdsec.connection" />}
					value={<Connection data={data} />}
					// the reason is in the alert above the cards, so the card only says when the data was read
					hint={<T id="monitoring.crowdsec.fetched" data={{ time: formatDateTime(data.fetchedAt) }} />}
					icon={data.reachable ? IconPlugConnected : IconPlugConnectedX}
					color={data.reachable ? "green" : "red"}
				/>
				{data.total === 0 ? (
					<div className="col-12">
						<EmptyCard>
							<EmptyState icon={IconShieldCheck} title={<T id="monitoring.crowdsec.no-bans" />} />
						</EmptyCard>
					</div>
				) : (
					<>
						<div className="col-lg-8">
							<div className="card">
								<div className="card-header">
									<h3 className="card-title">
										<T id="monitoring.crowdsec.map" />
									</h3>
								</div>
								<div className="card-body">
									<WorldMap
										countries={data.countries}
										color="red"
										label={intl.formatMessage({ id: "monitoring.crowdsec.map" })}
									/>
									{data.total > 0 && data.countries.length === 0 ? (
										<p className="text-secondary small mt-3 mb-0">
											<T id="monitoring.crowdsec.no-countries" />
										</p>
									) : null}
								</div>
							</div>
						</div>
						<TopList
							className="col-lg-4"
							title={<T id="monitoring.crowdsec.by-scenario" />}
							total={data.total}
							color="red"
							empty={noBans}
							items={data.byScenario.map((s) => ({
								key: s.scenario,
								label: <Scenario name={s.scenario} />,
								title: s.scenario,
								value: s.count,
							}))}
						/>
						<TopList
							className="col-md-6"
							title={<T id="monitoring.crowdsec.by-origin" />}
							total={data.total}
							color="red"
							empty={noBans}
							items={data.byOrigin.map((o) => ({
								key: o.origin,
								label: o.origin,
								title: o.origin,
								value: o.count,
							}))}
						/>
						<TopList
							className="col-md-6"
							title={<T id="monitoring.crowdsec.by-country" />}
							total={data.total}
							color="red"
							empty={noBans}
							items={data.countries.slice(0, 10).map((c) => ({
								key: c.country,
								label: <CountryName code={c.country} />,
								title: countryLabel(c.country),
								value: c.count,
							}))}
						/>
						<BansTable data={data} />
					</>
				)}
			</div>
		</>
	);
}

function EmptyCard({ children }) {
	return (
		<div className="card">
			<div className="card-body">{children}</div>
		</div>
	);
}

const Crowdsec = () => {
	const { data, error, isPending } = useMonitoringCrowdsec();

	if (isPending) return <Loading noLogo delay={300} />;
	if (error && !data) return <ErrorAlert error={error} />;
	// the bouncer config exists but could not be read (for example no permission): show why
	if (!data.configured && data.error) {
		return (
			<EmptyCard>
				<EmptyState
					icon={IconPlugConnectedX}
					title={<T id="monitoring.crowdsec.conf-error" />}
					subtitle={<T id="monitoring.crowdsec.unreachable.subtitle" data={{ error: data.error }} />}
					href={README_CROWDSEC}
					action={<T id="monitoring.crowdsec.readme" />}
				/>
			</EmptyCard>
		);
	}
	if (!data.configured) {
		return (
			<EmptyCard>
				<EmptyState
					icon={IconShieldOff}
					title={<T id="monitoring.crowdsec.off" />}
					subtitle={<T id="monitoring.crowdsec.off.subtitle" />}
					href={README_CROWDSEC}
					action={<T id="monitoring.crowdsec.readme" />}
				/>
			</EmptyCard>
		);
	}
	// never reached since the backend started: nothing to show but the reason
	if (!(data.reachable || data.fetchedAt)) {
		return (
			<EmptyCard>
				<EmptyState
					icon={IconPlugConnectedX}
					title={<T id="monitoring.crowdsec.unreachable.title" />}
					subtitle={<T id="monitoring.crowdsec.unreachable.subtitle" data={{ error: data.error ?? "" }} />}
				/>
			</EmptyCard>
		);
	}
	return <CrowdsecData data={data} />;
};

export default Crowdsec;
