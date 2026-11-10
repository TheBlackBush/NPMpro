import { createColumnHelper } from "@tanstack/react-table";
import { Eye, Lock, SquarePen, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyData, GravatarFormatter, RowActions, ValueWithDateFormatter } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { PagedTable } from "src/components/Table/TablePagination";
import { PAGED_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { useCanManage } from "src/hooks";
import { intl, T } from "src/locale";
import { ACCESS_LISTS } from "src/modules/Permissions";

function AccessListActions({ accessList, onDelete, onEdit }) {
	const canManage = useCanManage(ACCESS_LISTS);
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart
			label={intl.formatMessage({ id: "list.row-actions" }, { name: accessList.name || `#${accessList.id}` })}
			focusKey={`access-list-${accessList.id}`}
			title={<T id="object.actions-title" tData={{ object: "access-list" }} data={{ id: accessList.id }} />}
			items={[
				{
					key: "edit",
					// a user who may only view gets the View window
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? SquarePen : Eye,
					primary: true,
					ariaLabel: canManage
						? intl.formatMessage({ id: "list.row-edit" }, { name: accessList.name || `#${accessList.id}` })
						: intl.formatMessage({ id: "list.row-view" }, { name: accessList.name || `#${accessList.id}` }),
					onSelect: () => onEdit?.(accessList.id),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(accessList.id),
					destructive: true,
					separatorBefore: true,
					hidden: !canManage,
				},
			]}
		/>
	);
}

const columnHelper = createColumnHelper();

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// The columns keep their identity between renders and the row handlers reach the cells through the table meta
// (`meta.actions`); see the top of src/components/Table/hostColumns.jsx.
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
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.name" }),
				cell: (info) => (
					<ValueWithDateFormatter value={info.row.original.name} createdOn={info.row.original.createdOn} />
				),
			}),
			columnHelper.accessor((row) => row.items.length, {
				id: "items",
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						intl.formatMessage({ id: "access-list.auth-count" }, { count: row.items.length }),
				},
				header: intl.formatMessage({ id: "column.authorization" }),
				cell: (info) => <T id="access-list.auth-count" data={{ count: info.getValue() }} />,
			}),
			columnHelper.accessor((row) => row.clients.length, {
				id: "clients",
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						intl.formatMessage({ id: "access-list.access-count" }, { count: row.clients.length }),
				},
				header: intl.formatMessage({ id: "column.access" }),
				cell: (info) => <T id="access-list.access-count" data={{ count: info.getValue() }} />,
			}),
			columnHelper.accessor((row) => row.satisfyAny, {
				id: "satisfyAny",
				meta: { mobile: "hide" },
				header: intl.formatMessage({ id: "column.satisfy" }),
				cell: (info) => <T id={info.getValue() ? "column.satisfy-any" : "column.satisfy-all"} />,
			}),
			columnHelper.accessor((row) => row.proxyHostCount, {
				id: "proxyHostCount",
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						intl.formatMessage({ id: "proxy-hosts.count" }, { count: row.proxyHostCount }),
				},
				header: intl.formatMessage({ id: "proxy-hosts" }),
				cell: (info) => <T id="proxy-hosts.count" data={{ count: info.getValue() }} />,
			}),
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
				cell: (info) => (
					<AccessListActions accessList={info.row.original} {...info.table.options.meta?.actions} />
				),
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
	isFiltered,
	onEdit,
	onDelete,
	onNew,
	sorting,
	onSortingChange,
	paging,
}) {
	const columns = useColumns();

	const tableInstance = useAppTable({
		features: PAGED_FEATURES,
		columns: columnHelper.columns(columns),
		data,
		// the row handlers live here, not in the columns (see useColumns)
		meta: { isFetching, actions: { onDelete, onEdit } },
		state: { sorting, pagination: { pageIndex: paging.pageIndex, pageSize: paging.pageSize } },
		onSortingChange,
	});

	return (
		<PagedTable paging={paging} total={data.length}>
			<TableLayout
				tableInstance={tableInstance}
				emptyState={
					<EmptyData
						icon={Lock}
						object="access-list"
						objects="access-lists"
						tableInstance={tableInstance}
						onNew={onNew}
						isFiltered={isFiltered}
						section="accessLists"
						permissionSection={ACCESS_LISTS}
					/>
				}
			/>
		</PagedTable>
	);
}
