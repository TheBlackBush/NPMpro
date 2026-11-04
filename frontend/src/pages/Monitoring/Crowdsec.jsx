import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ClockPlusIcon, PlugZapIcon, ShieldBanIcon, ShieldCheckIcon, ShieldOffIcon, UnplugIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ErrorAlert, ListToolbar, Loading, NoticeAlert, StatusBadge } from "src/components";
import { CountryName, countryLabel, EmptyState, StatCard, TopList, WorldMap } from "src/components/Monitoring";
import { TableLayout } from "src/components/Table/TableLayout";
import { Button } from "src/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "src/components/ui/card";
import { useListFilters, useMonitoringCrowdsec } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { filterBans, formatCount, secondsLeftNow, timeLeftParts } from "src/modules/Monitoring";

// Top lists show at most this many rows; the share bars use the overall total
const TOP_LIST = 10;

const CROWDSEC_GUIDE = "https://github.com/TheBlackBush/NPMpro/wiki/CrowdSec";

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

// ban type to badge tone; any other type stays muted
const TYPE_TONES = { ban: "destructive", captcha: "warning" };

// "crowdsecurity/http-probing": the hub author muted, the scenario name as is; "manual" and others stay plain
function Scenario({ name }) {
	const slash = name.indexOf("/");
	if (slash <= 0) return <span>{name}</span>;
	return (
		<span>
			<span className="text-muted-foreground">{name.slice(0, slash + 1)}</span>
			{name.slice(slash + 1)}
		</span>
	);
}

function TypeBadge({ type }) {
	return (
		<StatusBadge tone={TYPE_TONES[type] ?? "muted"} dot={false}>
			{type}
		</StatusBadge>
	);
}

function Connection({ data }) {
	if (data.reachable) {
		return (
			<StatusBadge tone="success" pulse>
				<T id="monitoring.crowdsec.connected" />
			</StatusBadge>
		);
	}
	return (
		<StatusBadge tone="destructive">
			<T id="monitoring.crowdsec.unreachable" />
		</StatusBadge>
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
				cell: (info) => <span className="font-mono break-words">{info.getValue()}</span>,
			}),
			columnHelper.accessor("scenario", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.reason" }),
				enableSorting: false,
				cell: (info) => <Scenario name={info.getValue()} />,
			}),
			columnHelper.accessor("origin", {
				header: intl.formatMessage({ id: "monitoring.crowdsec.column.origin" }),
				enableSorting: false,
				cell: (info) => <span className="break-words">{info.getValue()}</span>,
				meta: { mobile: "hide" },
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
					<span className="whitespace-nowrap" title={info.row.original.duration}>
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
		<Card className="min-w-0 gap-0 py-0 @2xl:col-span-2">
			<CardHeader className="py-(--card-spacing)">
				<CardTitle role="heading" aria-level={2}>
					<T id="monitoring.crowdsec.newest" />
				</CardTitle>
				{data.total > rows.length ? (
					<CardDescription>
						<T id="monitoring.crowdsec.newest.subtitle" data={{ shown: rows.length, total: data.total }} />
					</CardDescription>
				) : null}
			</CardHeader>
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
				label={intl.formatMessage({ id: "monitoring.crowdsec.newest" })}
			/>
			{visible.length < displayed.length ? (
				<CardFooter className="justify-center border-t">
					<Button type="button" variant="link" onClick={() => setShowAll(true)}>
						<T id="monitoring.crowdsec.show-all" data={{ count: displayed.length }} />
					</Button>
				</CardFooter>
			) : null}
		</Card>
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
			{/* the grids follow the width of this container, not the viewport, so the sidebar layout gets fewer columns */}
			<div className="@container flex flex-col gap-4">
				<div className="grid gap-4 @2xl:grid-cols-3">
					<StatCard
						className="min-w-0"
						label={<T id="monitoring.crowdsec.active-bans" />}
						value={formatCount(data.total)}
						hint={types || undefined}
						icon={ShieldBanIcon}
						tone="destructive"
					/>
					<StatCard
						className="min-w-0"
						label={<T id="monitoring.crowdsec.added-24h" />}
						value={formatCount(data.added24h)}
						hint={<T id="monitoring.crowdsec.added-24h.hint" />}
						icon={ClockPlusIcon}
						tone="warning"
					/>
					<StatCard
						className="min-w-0"
						label={<T id="monitoring.crowdsec.connection" />}
						value={<Connection data={data} />}
						// the reason is in the alert above the cards, so the card only says when the data was read
						hint={<T id="monitoring.crowdsec.fetched" data={{ time: formatDateTime(data.fetchedAt) }} />}
						icon={data.reachable ? PlugZapIcon : UnplugIcon}
						tone={data.reachable ? "success" : "destructive"}
					/>
				</div>
				{data.total === 0 ? (
					<EmptyCard>
						<EmptyState icon={ShieldCheckIcon} title={<T id="monitoring.crowdsec.no-bans" />} />
					</EmptyCard>
				) : (
					<>
						<div className="grid gap-4 @4xl:grid-cols-3">
							<Card className="min-w-0 @4xl:col-span-2">
								<CardHeader>
									<CardTitle role="heading" aria-level={2}>
										<T id="monitoring.crowdsec.map" />
									</CardTitle>
								</CardHeader>
								<CardContent>
									<WorldMap
										countries={data.countries}
										tone="destructive"
										label={intl.formatMessage({ id: "monitoring.crowdsec.map" })}
									/>
									{data.total > 0 && data.countries.length === 0 ? (
										<p className="mt-3 mb-0 text-sm text-muted-foreground">
											<T id="monitoring.crowdsec.no-countries" />
										</p>
									) : null}
								</CardContent>
							</Card>
							<TopList
								className="min-w-0"
								title={<T id="monitoring.crowdsec.by-scenario" />}
								total={data.total}
								tone="destructive"
								empty={noBans}
								items={data.byScenario.slice(0, TOP_LIST).map((s) => ({
									key: s.scenario,
									label: <Scenario name={s.scenario} />,
									title: s.scenario,
									value: s.count,
								}))}
							/>
						</div>
						<div className="grid gap-4 @2xl:grid-cols-2">
							<TopList
								className="min-w-0"
								title={<T id="monitoring.crowdsec.by-origin" />}
								total={data.total}
								tone="destructive"
								empty={noBans}
								items={data.byOrigin.slice(0, TOP_LIST).map((o) => ({
									key: o.origin,
									label: o.origin,
									title: o.origin,
									value: o.count,
								}))}
							/>
							<TopList
								className="min-w-0"
								title={<T id="monitoring.crowdsec.by-country" />}
								total={data.total}
								tone="destructive"
								empty={noBans}
								items={data.countries.slice(0, TOP_LIST).map((c) => ({
									key: c.country,
									label: <CountryName code={c.country} />,
									title: countryLabel(c.country),
									value: c.count,
								}))}
							/>
							<BansTable data={data} />
						</div>
					</>
				)}
			</div>
		</>
	);
}

function EmptyCard({ children }) {
	return (
		<Card>
			<CardContent>{children}</CardContent>
		</Card>
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
					icon={UnplugIcon}
					title={<T id="monitoring.crowdsec.conf-error" />}
					subtitle={<T id="monitoring.crowdsec.unreachable.subtitle" data={{ error: data.error }} />}
					href={CROWDSEC_GUIDE}
					action={<T id="monitoring.crowdsec.guide" />}
				/>
			</EmptyCard>
		);
	}
	if (!data.configured) {
		return (
			<EmptyCard>
				<EmptyState
					icon={ShieldOffIcon}
					title={<T id="monitoring.crowdsec.off" />}
					subtitle={<T id="monitoring.crowdsec.off.subtitle" />}
					href={CROWDSEC_GUIDE}
					action={<T id="monitoring.crowdsec.guide" />}
				/>
			</EmptyCard>
		);
	}
	// never reached since the backend started: nothing to show but the reason
	if (!(data.reachable || data.fetchedAt)) {
		return (
			<EmptyCard>
				<EmptyState
					icon={UnplugIcon}
					title={<T id="monitoring.crowdsec.unreachable.title" />}
					subtitle={<T id="monitoring.crowdsec.unreachable.subtitle" data={{ error: data.error ?? "" }} />}
				/>
			</EmptyCard>
		);
	}
	return <CrowdsecData data={data} />;
};

export default Crowdsec;
