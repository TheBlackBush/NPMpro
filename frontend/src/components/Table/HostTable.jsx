import { EmptyData } from "src/components/EmptyData";
import { TableLayout } from "./TableLayout";
import { useAppTable } from "./useAppTable";

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
}) {
	const tableInstance = useAppTable({
		columns,
		data,
		meta: {
			isFetching,
			actions: { onClone, onDelete, onDisableToggle, onEdit },
		},
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
	);
}
