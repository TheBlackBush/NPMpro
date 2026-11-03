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
import { ArrowLeftRight, Copy, Eye, Pencil, Power, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
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
import { REDIRECTION_HOSTS } from "src/modules/Permissions";

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

const redirectSummary = (row) => {
	const target =
		row.forwardScheme === "$scheme" ? row.forwardDomainName : `${row.forwardScheme}://${row.forwardDomainName}`;
	return [target, row.forwardHttpCode].filter(Boolean).join(" · ");
};
const tlsSummary = (row) => intl.formatMessage({ id: row.certificate ? "column.ssl" : "no-tls" });

function RedirectionHostActions({ host, onClone, onDelete, onDisableToggle, onEdit }) {
	const canManage = useCanManage(REDIRECTION_HOSTS);
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart (the first domain is what the row shows)
			label={intl.formatMessage({ id: "list.row-actions" }, { name: host.domainNames[0] ?? `#${host.id}` })}
			focusKey={`redirection-host-${host.id}`}
			title={<T id="object.actions-title" tData={{ object: "redirection-host" }} data={{ id: host.id }} />}
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
// Stable columns, row handlers through the table meta: see ProxyHosts/Table.jsx.
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
			columnHelper.accessor((row) => row.forwardHttpCode, {
				id: "forwardHttpCode",
				// the code and the scheme show inside the target's summary text ("https://target · 301")
				meta: { mobile: "summary", summaryText: () => null },
				header: intl.formatMessage({ id: "column.http-code" }),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.forwardScheme, {
				id: "forwardScheme",
				meta: { mobile: "summary", summaryText: () => null },
				header: intl.formatMessage({ id: "column.scheme" }),
				cell: (info) =>
					info.getValue() === "$scheme"
						? intl.formatMessage({ id: "redirection.scheme.keep" })
						: info.getValue(),
			}),
			columnHelper.accessor((row) => row.forwardDomainName, {
				id: "forwardDomainName",
				meta: { mobile: "summary", summaryText: redirectSummary },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => (row.certificate ? row.certificate.provider : "http-only"), {
				id: "certificate",
				meta: { mobile: "summary", summaryText: tlsSummary },
				header: intl.formatMessage({ id: "column.ssl" }),
				cell: (info) => <CertificateFormatter certificate={info.row.original.certificate} />,
			}),
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
				cell: (info) => (
					<RedirectionHostActions host={info.row.original} {...info.table.options.meta?.actions} />
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
					icon={ArrowLeftRight}
					section="redirectionHosts"
					object="redirection-host"
					objects="redirection-hosts"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					permissionSection={REDIRECTION_HOSTS}
				/>
			}
		/>
	);
}
