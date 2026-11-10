import { EmptyData } from "src/components/EmptyData";
import { TableLayout } from "./TableLayout";
import { PagedTable } from "./TablePagination";
import { PAGED_FEATURES, useAppTable } from "./useAppTable";

/**
 * The table of a host list: rows sorted by the list page, row handlers through the table meta, the empty state
 *
 * @param {Object} props.empty  { icon, section, object, objects } of the empty state; section is also the permission
 */
export function HostTable({
	columns,
	empty,
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
	paging,
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
			actions: { onClone, onDelete, onDisableToggle, onEdit },
		},
		state: { sorting, pagination },
		onSortingChange,
	});

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
