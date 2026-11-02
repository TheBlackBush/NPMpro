import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { Copy, Eye, Pencil, Power, Trash2, Zap } from "lucide-react";
import { useMemo } from "react";
import {
	AccessListFormatter,
	CertificateFormatter,
	DomainsFormatter,
	EmptyData,
	GravatarFormatter,
	RowActions,
	StatusFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { useCanManage } from "src/hooks";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { PROXY_HOSTS } from "src/modules/Permissions";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

const columnHelper = createColumnHelper();

const accessSummary = (row) =>
	row.accessLists.length > 0
		? row.accessLists.map((list) => list.name).join(", ")
		: intl.formatMessage({
				id: row.npmproAccessListType === "custom" ? "access-list.custom" : "access-list.public",
			});
const tlsSummary = (row) => intl.formatMessage({ id: row.certificate ? "column.ssl" : "no-tls" });

function ProxyHostActions({ host, onClone, onDelete, onDisableToggle, onEdit }) {
	const canManage = useCanManage(PROXY_HOSTS);
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart (the first domain is what the row shows)
			label={intl.formatMessage({ id: "list.row-actions" }, { name: host.domainNames[0] ?? `#${host.id}` })}
			focusKey={`proxy-host-${host.id}`}
			title={<T id="object.actions-title" tData={{ object: "proxy-host" }} data={{ id: host.id }} />}
			items={[
				{
					key: "edit",
					// a user who may only view gets the View window
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? Pencil : Eye,
					onSelect: () => onEdit?.(host.id),
				},
				{
					key: "clone",
					label: <T id="action.clone" />,
					icon: Copy,
					onSelect: () => onClone?.(host.id),
					hidden: !canManage,
				},
				{
					key: "toggle",
					label: <T id={host.enabled ? "action.disable" : "action.enable"} />,
					icon: Power,
					onSelect: () => onDisableToggle?.(host.id, !host.enabled),
					hidden: !canManage,
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(host.id),
					destructive: true,
					separatorBefore: true,
					hidden: !canManage,
				},
			]}
		/>
	);
}

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
//
// The columns must keep their identity between renders: flexRender renders a column's `cell` function as a React
// component, so a new function (columns rebuilt on every render) remounts every cell, which drops focus and open
// popovers on each refetch or search keystroke. So the memo has no dependencies (a language change reloads the page)
// and the row handlers reach the cells through the table meta (`meta.actions`, read in the cell from
// info.table.options.meta), never through the column definitions. Later list pages follow the same pattern.
export function useColumns() {
	return useMemo(
		() => [
			columnHelper.accessor((row) => row.owner?.name, {
				id: "owner",
				enableSorting: false,
				cell: (info) => {
					const value = info.row.original.owner;
					return (
						<GravatarFormatter
							url={value ? value.avatar : ""}
							name={value ? value.name : intl.formatMessage({ id: "user.deleted" })}
						/>
					);
				},
				meta: {
					className: "whitespace-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.accessor((row) => row.domainNames.join(", "), {
				id: "domainNames",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.source" }),
				cell: (info) => {
					const value = info.row.original;
					return <DomainsFormatter domains={value.domainNames} createdOn={value.createdOn} />;
				},
			}),
			columnHelper.accessor(forwardSummary, {
				id: "forwardHost",
				meta: { mobile: "summary", summaryText: (row) => forwardSummary(row) || null },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => {
					if (info.row.original.forwardScheme === "path" || !info.getValue()) {
						return info.getValue();
					}
					return (
						<a href={info.getValue()} target="_blank" rel="noopener">
							{info.getValue()}
						</a>
					);
				},
			}),
			columnHelper.accessor((row) => (row.certificate ? row.certificate.provider : "http-only"), {
				id: "certificate",
				meta: { mobile: "summary", summaryText: tlsSummary },
				header: intl.formatMessage({ id: "column.ssl" }),
				cell: (info) => <CertificateFormatter certificate={info.row.original.certificate} />,
			}),
			columnHelper.accessor(
				(row) => {
					const { accessLists } = row;
					const triggerLabel = intl.formatMessage({
						id: row.npmproAccessListType === "custom" ? "access-list.custom" : "access-list.public",
					});
					if (accessLists.length === 1) {
						return accessLists[0].name;
					}
					return triggerLabel;
				},
				{
					id: "accessList",
					meta: { mobile: "summary", summaryText: accessSummary },
					header: intl.formatMessage({ id: "column.access" }),
					cell: (info) => (
						<AccessListFormatter
							proxyHostId={info.row.original.id}
							locations={info.row.original.locations}
							access={info.row.original.accessLists}
							type={info.row.original.npmproAccessListType}
						/>
					),
				},
			),
			columnHelper.accessor(
				(row) => {
					if (!row.enabled) return "3disabled";
					if (row.npmproNginxOnline) return "2online";
					return "1offline";
				},
				{
					id: "enabled",
					meta: { mobile: "title-below" },
					header: intl.formatMessage({ id: "column.status" }),
					cell: (info) => {
						const value = info.row.original;
						return (
							<StatusFormatter
								enabled={value.enabled}
								nginxOnline={value.npmproNginxOnline}
								nginxErr={value.npmproNginxErr}
							/>
						);
					},
				},
			),
			columnHelper.accessor((row) => row.id, {
				id: "id",
				header: "ID",
				cell: (info) => info.getValue(),
				meta: {
					className: "w-px whitespace-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => <ProxyHostActions host={info.row.original} {...info.table.options.meta?.actions} />,
				meta: {
					className: "text-right whitespace-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[],
	);
}

export default function Table({
	data,
	isFetching,
	onEdit,
	onClone,
	onDelete,
	onDisableToggle,
	onNew,
	isFiltered,
	onClearFilters,
	sorting,
	onSortingChange,
	showHeader,
	groupBy,
	renderGroupLabel,
}) {
	const columns = useColumns();

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		// the row handlers live here, not in the columns (see useColumns)
		meta: {
			isFetching,
			actions: { onClone, onDelete, onDisableToggle, onEdit },
		},
		enableSortingRemoval: false,
		state: { sorting },
		onSortingChange,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			showHeader={showHeader}
			groupBy={groupBy}
			renderGroupLabel={renderGroupLabel}
			emptyState={
				<EmptyData
					icon={Zap}
					object="proxy-host"
					objects="proxy-hosts"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					permissionSection={PROXY_HOSTS}
				/>
			}
		/>
	);
}
