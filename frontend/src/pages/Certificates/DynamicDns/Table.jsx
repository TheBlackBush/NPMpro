import { createColumnHelper } from "@tanstack/react-table";
import { Eye, History, Power, RefreshCw, SquarePen, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button, EmptyData, HasPermission, RowActions, StatusBadge, ValueWithDateFormatter } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { PagedTable } from "src/components/Table/TablePagination";
import { PAGED_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { useCanManage, useDdnsProviders, useIsAdmin } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDdnsRecordModal } from "src/modals";
import { IP_VERSIONS, recordStateOf } from "src/modules/DdnsForms";
import { ageOf, recordAddressOf } from "src/modules/DdnsStatus";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";
import { ddnsErrorText } from "./errorText";

function RecordActions({ record, updating, onEdit, onUpdateNow, onHistory, onToggle, onDelete }) {
	// a custom HTTP record belongs to the administrators: anyone else may only view it
	const isAdmin = useIsAdmin();
	const canManage = useCanManage(CERTIFICATES) && !(record.provider === "custom" && isAdmin === false);
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart
			label={intl.formatMessage({ id: "list.row-actions" }, { name: record.name })}
			focusKey={`ddns-record-${record.id}`}
			title={<T id="object.actions-title" tData={{ object: "ddns-record" }} data={{ id: record.id }} />}
			items={[
				{
					key: "edit",
					// a user who may only view gets the View window
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? SquarePen : Eye,
					primary: true,
					ariaLabel: canManage
						? intl.formatMessage({ id: "list.row-edit" }, { name: record.name })
						: intl.formatMessage({ id: "list.row-view" }, { name: record.name }),
					onSelect: () => onEdit?.(record.id),
				},
				{
					key: "update-now",
					label: <T id="ddns.action.update-now" />,
					icon: RefreshCw,
					onSelect: () => onUpdateNow?.(record.id),
					hidden: !canManage || !record.enabled,
					disabled: updating,
				},
				{
					key: "history",
					label: <T id="ddns.action.history" />,
					icon: History,
					onSelect: () => onHistory?.(record.id),
				},
				{
					key: "toggle",
					label: <T id={record.enabled ? "action.disable" : "action.enable"} />,
					icon: Power,
					onSelect: () => onToggle?.(record.id),
					hidden: !canManage,
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(record.id),
					destructive: true,
					separatorBefore: true,
					hidden: !canManage,
				},
			]}
		/>
	);
}

function RecordState({ record, updating }) {
	if (updating) {
		return (
			<StatusBadge tone="info" pulse>
				<T id="ddns.state.updating" />
			</StatusBadge>
		);
	}
	const state = recordStateOf(record, Date.now());
	const message = state.kind === "failed" ? ddnsErrorText(record) : null;
	const age = state.kind === "ok" ? ageOf(state.at, Date.now()) : null;
	const labels = {
		ok: age ? (
			<T id="ddns.state.ok-age" data={{ age: intl.formatRelativeTime(age.value, age.unit) }} />
		) : (
			<T id="ddns.state.ok" />
		),
		updated: <T id="ddns.state.updated" data={{ time: state.at ? formatDateTime(state.at) : "" }} />,
		pending: <T id="ddns.state.pending" />,
		failed: message ? <T id="ddns.state.failed" data={{ message }} /> : <T id="ddns.state.failed-plain" />,
		disabled: <T id="ddns.state.disabled" />,
	};
	const tones = { ok: "success", updated: "success", pending: "info", failed: "destructive", disabled: "muted" };
	return (
		<div className="flex flex-col items-start gap-1">
			<div className="flex flex-wrap items-center gap-1">
				<StatusBadge tone={tones[state.kind]} className="whitespace-normal text-left">
					{labels[state.kind]}
				</StatusBadge>
				{state.proxied ? (
					<StatusBadge tone="info" dot={false}>
						<T id="ddns.state.proxied" />
					</StatusBadge>
				) : null}
			</div>
			{state.nextTry ? (
				<span className="text-xs text-muted-foreground">
					<T id="ddns.state.next-try" data={{ time: formatDateTime(state.nextTry) }} />
				</span>
			) : null}
		</div>
	);
}

const columnHelper = createColumnHelper();

// the Address cell on a phone's summary line: the alias target or the written addresses
const addressSummary = (row) => {
	const shown = recordAddressOf(row);
	if (shown.alias !== undefined) return shown.alias ? `→ ${shown.alias}` : null;
	return shown.addresses.length > 0 ? shown.addresses.join(", ") : null;
};

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// The row handlers reach the cells through the table meta (`meta.actions`, `meta.updatingId`), see hostColumns.jsx.
export function useColumns() {
	const { data: providers } = useDdnsProviders();
	return useMemo(() => {
		const providerLabel = (id) => providers?.find((p) => p.id === id)?.label ?? id;
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "ddns.column.name" }),
				cell: (info) => (
					<ValueWithDateFormatter value={info.getValue()} createdOn={info.row.original.createdOn} />
				),
			}),
			columnHelper.accessor((row) => providerLabel(row.provider), {
				id: "provider",
				meta: { mobile: "summary", summaryText: (row) => providerLabel(row.provider) },
				header: intl.formatMessage({ id: "ddns.column.provider" }),
				cell: (info) => (
					<>
						<div>{info.getValue()}</div>
						<div className="text-muted-foreground">{info.row.original.credential?.name}</div>
					</>
				),
			}),
			columnHelper.accessor((row) => (row.kind === "alias" ? "" : row.ipVersion), {
				id: "ipVersion",
				enableSorting: false,
				meta: {
					mobile: "summary",
					summaryText: (row) => (row.kind === "alias" ? "CNAME" : IP_VERSIONS[row.ipVersion]),
				},
				header: intl.formatMessage({ id: "ddns.column.ip-version" }),
				cell: (info) =>
					info.row.original.kind === "alias" ? (
						<T id="ddns.kind.alias" />
					) : (
						(IP_VERSIONS[info.getValue()] ?? info.getValue())
					),
			}),
			columnHelper.accessor((row) => row.target ?? row.lastIpv4 ?? row.lastIpv6 ?? "", {
				id: "address",
				enableSorting: false,
				meta: { mobile: "summary", summaryText: addressSummary },
				header: intl.formatMessage({ id: "ddns.column.address" }),
				cell: (info) => {
					const shown = recordAddressOf(info.row.original);
					if (shown.alias !== undefined) {
						return <span className="wrap-anywhere">{`→ ${shown.alias}`}</span>;
					}
					if (shown.addresses.length === 0) return <span className="text-muted-foreground">-</span>;
					return (
						<div className="flex flex-col font-mono text-sm">
							{shown.addresses.map((address) => (
								<span key={address} className="wrap-anywhere">
									{address}
								</span>
							))}
						</div>
					);
				},
			}),
			columnHelper.accessor((row) => row.state, {
				id: "state",
				enableSorting: false,
				// on a phone the state shows under the name, as the host lists show their status
				meta: { mobile: "title-below" },
				header: intl.formatMessage({ id: "ddns.column.state" }),
				cell: (info) => (
					<RecordState
						record={info.row.original}
						updating={info.table.options.meta?.updatingId === info.row.original.id}
					/>
				),
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<RecordActions
						record={info.row.original}
						updating={info.table.options.meta?.updatingId === info.row.original.id}
						{...info.table.options.meta?.actions}
					/>
				),
				meta: {
					className: "text-right whitespace-nowrap",
					mobile: "title-end",
				},
			}),
		];
	}, [providers]);
}

export default function Table({
	data,
	paging,
	isFetching,
	isFiltered,
	onClearFilters,
	updatingId,
	onEdit,
	onUpdateNow,
	onHistory,
	onToggle,
	onDelete,
	sorting,
	onSortingChange,
}) {
	const columns = useColumns();

	const tableInstance = useAppTable({
		features: PAGED_FEATURES,
		columns: columnHelper.columns(columns),
		data,
		// the row handlers live here, not in the columns (see useColumns)
		meta: { isFetching, updatingId, actions: { onEdit, onUpdateNow, onHistory, onToggle, onDelete } },
		state: { sorting, pagination: { pageIndex: paging.pageIndex, pageSize: paging.pageSize } },
		onSortingChange,
	});

	return (
		<PagedTable paging={paging} total={data.length}>
			<TableLayout
				tableInstance={tableInstance}
				emptyState={
					<EmptyData
						icon={RefreshCw}
						tableInstance={tableInstance}
						isFiltered={isFiltered}
						onClearFilters={onClearFilters}
						section="dnsDomains"
						permissionSection={CERTIFICATES}
						message={<T id="ddns.empty" />}
						subtitle={<T id="ddns.empty-text" />}
						customAddBtn={
							<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
								<Button color="primary" onClick={() => showDdnsRecordModal()}>
									<T id="ddns.add" />
								</Button>
							</HasPermission>
						}
					/>
				}
			/>
		</PagedTable>
	);
}
