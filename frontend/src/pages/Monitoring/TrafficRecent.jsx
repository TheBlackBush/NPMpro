import { createColumnHelper } from "@tanstack/react-table";
import { ListIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { BreakableHost, ListToolbar, StatusBadge } from "src/components";
import { CountryName, countryLabel, EmptyState } from "src/components/Monitoring";
import { TableLayout } from "src/components/Table/TableLayout";
import { PLAIN_SORT_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { TapTooltip } from "src/components/TapTooltip";
import { Button } from "src/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "src/components/ui/card";
import { useListFilters } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { filterRecent, formatBytes, hostEntryLabel, statusTone } from "src/modules/Monitoring";

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

const columnHelper = createColumnHelper();

export function HostBadge({ badge }) {
	if (!badge) return null;
	return (
		<StatusBadge tone={BADGES[badge].tone} dot={false}>
			<T id={BADGES[badge].labelKey} />
		</StatusBadge>
	);
}

/** Shown host of a recent request: "Other hosts" for _other, otherwise the first domain name. */
const recentHostName = (row) =>
	row.hostType === "other" ? intl.formatMessage({ id: "monitoring.host.other" }) : hostEntryLabel(row).name;

/**
 * The newest requests the backend keeps in memory (the selected host's or all), like "Newest bans": search, the
 * first 25 rows (10 below the md breakpoint) with "Show all", the IP column only when the API sends IPs.
 */
export function RecentTable({ rows }) {
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

	// newest first, as the API sends them; no column sorting, like the newest bans table
	const tableInstance = useAppTable({
		features: PLAIN_SORT_FEATURES,
		enableSortingRemoval: true,
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
