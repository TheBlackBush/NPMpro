import {
	IconDevicesX,
	IconDotsVertical,
	IconEdit,
	IconLock,
	IconPower,
	IconShield,
	IconShieldOff,
	IconTrash,
	IconUsers,
} from "@tabler/icons-react";
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
import {
	EmailFormatter,
	EmptyData,
	GravatarFormatter,
	RolesFormatter,
	TrueFalseFormatter,
	ValueWithDateFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";

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

const rolesSummary = (row) =>
	(row.roles.length ? row.roles : ["standard-user"])
		.map((role) => intl.formatMessage({ id: `role.${role}` }))
		.join(", ");

// shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns({
	currentUserId,
	onEditUser,
	onEditPermissions,
	onSetPassword,
	onResetMfa,
	onRevokeSessions,
	onDeleteUser,
	onDisableToggle,
} = {}) {
	return useMemo(
		() => [
			columnHelper.accessor((row) => row.name, {
				id: "avatar",
				enableSorting: false,
				cell: (info) => {
					const value = info.row.original;
					return <GravatarFormatter url={value.avatar} name={value.name} decorative />;
				},
				meta: {
					className: "text-nowrap",
					mobile: "hide",
				},
			}),
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.name" }),
				cell: (info) => {
					const value = info.row.original;
					// Hack to reuse domains formatter
					return (
						<ValueWithDateFormatter
							value={value.name}
							createdOn={value.createdOn}
							disabled={value.isDisabled}
						/>
					);
				},
			}),
			columnHelper.accessor((row) => row.email, {
				id: "email",
				meta: { mobile: "summary", summaryText: (row) => row.email },
				header: intl.formatMessage({ id: "column.email" }),
				cell: (info) => <EmailFormatter email={info.getValue()} />,
			}),
			columnHelper.accessor((row) => row.roles.join(", "), {
				id: "roles",
				meta: { mobile: "summary", summaryText: rolesSummary },
				header: intl.formatMessage({ id: "column.roles" }),
				cell: (info) => <RolesFormatter roles={info.row.original.roles} />,
			}),
			columnHelper.accessor((row) => row.isDisabled, {
				id: "isDisabled",
				meta: { mobile: "title-below" },
				header: intl.formatMessage({ id: "column.status" }),
				cell: (info) => <TrueFalseFormatter value={!info.getValue()} />,
			}),
			columnHelper.accessor((row) => row.id, {
				id: "id",
				header: "ID",
				cell: (info) => info.getValue(),
				meta: {
					className: "w-1 text-nowrap",
					mobile: "hide",
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
									tData={{ object: "user" }}
									data={{ id: info.row.original.id }}
								/>
							</span>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onEditUser?.(info.row.original.id);
								}}
							>
								<IconEdit className="icon dropdown-item-icon" aria-hidden="true" />
								<T id="action.edit" />
							</button>
							{currentUserId !== info.row.original.id ? (
								<>
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onEditPermissions?.(info.row.original.id);
										}}
									>
										<IconShield className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="action.permissions" />
									</button>
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onSetPassword?.(info.row.original.id);
										}}
									>
										<IconLock className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="user.set-password" />
									</button>
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onResetMfa?.(info.row.original.id);
										}}
									>
										<IconShieldOff className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="user.reset-mfa" />
									</button>
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onRevokeSessions?.(info.row.original.id);
										}}
									>
										<IconDevicesX className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="user.revoke-sessions" />
									</button>
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onDisableToggle?.(info.row.original.id, info.row.original.isDisabled);
										}}
									>
										<IconPower className="icon dropdown-item-icon" aria-hidden="true" />
										<T id={info.row.original.isDisabled ? "action.enable" : "action.disable"} />
									</button>
									<div className="dropdown-divider" />
									<button
										type="button"
										className="dropdown-item text-danger"
										onClick={() => {
											onDeleteUser?.(info.row.original.id);
										}}
									>
										<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="action.delete" />
									</button>
								</>
							) : null}
						</div>
					</span>
				),
				meta: {
					className: "text-end text-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[
			currentUserId,
			onEditUser,
			onDisableToggle,
			onDeleteUser,
			onEditPermissions,
			onSetPassword,
			onResetMfa,
			onRevokeSessions,
		],
	);
}

export default function Table({
	data,
	isFiltered,
	isFetching,
	currentUserId,
	onEditUser,
	onEditPermissions,
	onSetPassword,
	onResetMfa,
	onRevokeSessions,
	onDeleteUser,
	onDisableToggle,
	onNewUser,
	sorting,
	onSortingChange,
}) {
	const columns = useColumns({
		currentUserId,
		onEditUser,
		onEditPermissions,
		onSetPassword,
		onResetMfa,
		onRevokeSessions,
		onDeleteUser,
		onDisableToggle,
	});

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
					icon={IconUsers}
					object="user"
					objects="users"
					tableInstance={tableInstance}
					onNew={onNewUser}
					isFiltered={isFiltered}
					color="orange"
				/>
			}
		/>
	);
}
