import { EmptyData } from "src/components/EmptyData";
import { pageRows } from "src/modules/TableGroups";
import { TableLayout } from "./TableLayout";
import { PagedTable } from "./TablePagination";
import { PAGED_FEATURES, useAppTable } from "./useAppTable";

/**
 * The table of a host list: rows sorted by the list page, row handlers through the table meta, the empty state
 *
 * @param {Object} props.empty  { icon, section, object, objects } of the empty state; section is also the permission
 * @param {Map} [props.dnsChecks]  the cached DNS checks of the host type by host id (the badge after the names)
 * @param {{ current: Array }} [props.pageRowsRef]  receives the hosts of the page shown (what "Check DNS" checks)
 */
export function HostTable({
	columns,
	empty,
	data,
	isFetching,
	onEdit,
	onTagClick,
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
	paging,
	dnsChecks,
	pageRowsRef,
}) {
	// a grouped list cuts its pages after the groups are ordered (TableBody), so the table passes every row on
	const pagination = groupBy
		? { pageIndex: 0, pageSize: Math.max(1, data.length) }
		: { pageIndex: paging.pageIndex, pageSize: paging.pageSize };
	const tableInstance = useAppTable({
		features: PAGED_FEATURES,
		columns,
		data,
		meta: {
			isFetching,
			dnsChecks,
			actions: { onClone, onDelete, onDisableToggle, onEdit, onTagClick },
		},
		state: { sorting, pagination },
		onSortingChange,
	});

	if (pageRowsRef) {
		pageRowsRef.current = pageRows({
			rows: tableInstance.getRowModel().rows.map((row) => row.original),
			keyOf: groupBy,
			pageIndex: paging.pageIndex,
			pageSize: paging.pageSize,
		});
	}

	return (
		<PagedTable paging={paging} total={data.length}>
			<TableLayout
				tableInstance={tableInstance}
				showHeader={showHeader}
				groupBy={groupBy}
				page={groupBy ? paging : undefined}
				renderGroupLabel={renderGroupLabel}
				emptyState={
					<EmptyData
						icon={empty.icon}
						section={empty.section}
						object={empty.object}
						objects={empty.objects}
						tableInstance={tableInstance}
						onNew={onNew}
						isFiltered={isFiltered}
						onClearFilters={onClearFilters}
						permissionSection={empty.section}
					/>
				}
			/>
		</PagedTable>
	);
}
