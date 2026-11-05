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
import { Lock, MonitorOff, Pencil, Power, ShieldCheck, ShieldOff, Trash2, Users } from "lucide-react";
import { useMemo } from "react";
import {
	EmailFormatter,
	EmptyData,
	GravatarFormatter,
	RolesFormatter,
	RowActions,
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

function UserActions({
	user,
	currentUserId,
	mfaUserIds,
	onEditUser,
	onEditPermissions,
	onSetPassword,
	onResetMfa,
	onRevokeSessions,
	onDeleteUser,
	onDisableToggle,
}) {
	// the other items act on another account: not offered on your own row
	const other = currentUserId !== user.id;
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart
			label={intl.formatMessage({ id: "list.row-actions" }, { name: user.name || `#${user.id}` })}
			focusKey={`user-${user.id}`}
			title={<T id="object.actions-title" tData={{ object: "user" }} data={{ id: user.id }} />}
			items={[
				{ key: "edit", label: <T id="action.edit" />, icon: Pencil, onSelect: () => onEditUser?.(user.id) },
				{
					key: "permissions",
					label: <T id="action.permissions" />,
					icon: ShieldCheck,
					onSelect: () => onEditPermissions?.(user.id),
					hidden: !other,
				},
				{
					key: "set-password",
					label: <T id="user.set-password" />,
					icon: Lock,
					onSelect: () => onSetPassword?.(user.id),
					hidden: !other,
				},
				{
					key: "reset-mfa",
					label: <T id="user.reset-mfa" />,
					icon: ShieldOff,
					onSelect: () => onResetMfa?.(user.id),
					// nothing to reset without MFA
					hidden: !other || !mfaUserIds?.has(user.id),
				},
				{
					key: "revoke-sessions",
					label: <T id="user.revoke-sessions" />,
					icon: MonitorOff,
					onSelect: () => onRevokeSessions?.(user.id),
					hidden: !other,
				},
				{
					key: "toggle",
					label: <T id={user.isDisabled ? "action.enable" : "action.disable"} />,
					icon: Power,
					onSelect: () => onDisableToggle?.(user.id, user.isDisabled),
					hidden: !other,
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDeleteUser?.(user.id),
					destructive: true,
					separatorBefore: true,
					hidden: !other,
				},
			]}
		/>
	);
}

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// The columns keep their identity between renders and the row handlers reach the cells through the table meta
// (`meta.actions`); see the comment above useColumns in src/pages/Nginx/ProxyHosts/Table.jsx.
export function useColumns() {
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
					className: "whitespace-nowrap md:@max-3xl:hidden",
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
				// one line in a narrow column (the section next to the sidebar), where it would break in three
				meta: { className: "@max-3xl:whitespace-nowrap", mobile: "summary", summaryText: (row) => row.email },
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
					// hidden in a narrow column (the section next to the sidebar), where the e-mail needs the room
					className: "w-px whitespace-nowrap md:@max-3xl:hidden",
					mobile: "hide",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => <UserActions user={info.row.original} {...info.table.options.meta?.actions} />,
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
	isFiltered,
	isFetching,
	currentUserId,
	mfaUserIds,
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
	const columns = useColumns();

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		// the row handlers live here, not in the columns (see useColumns)
		meta: {
			isFetching,
			actions: {
				currentUserId,
				mfaUserIds,
				onEditUser,
				onEditPermissions,
				onSetPassword,
				onResetMfa,
				onRevokeSessions,
				onDeleteUser,
				onDisableToggle,
			},
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
					icon={Users}
					object="user"
					objects="users"
					tableInstance={tableInstance}
					onNew={onNewUser}
					isFiltered={isFiltered}
				/>
			}
		/>
	);
}
