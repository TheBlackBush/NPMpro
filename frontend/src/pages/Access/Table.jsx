import { IconDotsVertical, IconEdit, IconLock, IconTrash } from "@tabler/icons-react";
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
import { useMemo } from "react";
import { EmptyData, GravatarFormatter, HasPermission, ValueWithDateFormatter } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";

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

// shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns({ onEdit, onDelete } = {}) {
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
					className: "text-nowrap",
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
					className: "w-1 text-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<span className="dropdown">
						<button
							type="button"
							className="btn dropdown-toggle btn-action btn-sm px-1 d-inline-block"
							aria-label={intl.formatMessage({ id: "actions" })}
							data-bs-boundary="viewport"
							data-bs-toggle="dropdown"
							data-bs-popper-config='{"strategy":"fixed"}'
						>
							<IconDotsVertical />
						</button>
						<div className="dropdown-menu dropdown-menu-end">
							<span className="dropdown-header">
								<T
									id="object.actions-title"
									tData={{ object: "access-list" }}
									data={{ id: info.row.original.id }}
								/>
							</span>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onEdit?.(info.row.original.id);
								}}
							>
								<IconEdit className="icon dropdown-item-icon" aria-hidden="true" />
								<T id="action.edit" />
							</button>
							<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
								<div className="dropdown-divider" />
								<button
									type="button"
									className="dropdown-item text-danger"
									onClick={() => {
										onDelete?.(info.row.original.id);
									}}
								>
									<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="action.delete" />
								</button>
							</HasPermission>
						</div>
					</span>
				),
				meta: {
					className: "text-end text-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[onEdit, onDelete],
	);
}

export default function Table({ data, isFetching, isFiltered, onEdit, onDelete, onNew, sorting, onSortingChange }) {
	const columns = useColumns({ onEdit, onDelete });

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		meta: {
			isFetching,
		},
		enableSortingRemoval: false,
		state: { sorting },
		onSortingChange,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={IconLock}
					object="access-list"
					objects="access-lists"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					color="cyan"
					permissionSection={ACCESS_LISTS}
				/>
			}
		/>
	);
}
