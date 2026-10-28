import { IconArrowsCross, IconDotsVertical, IconEdit, IconPower, IconTrash } from "@tabler/icons-react";
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
	CertificateFormatter,
	DomainsFormatter,
	EmptyData,
	GravatarFormatter,
	HasPermission,
	StatusFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { MANAGE, REDIRECTION_HOSTS } from "src/modules/Permissions";

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

// shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns({ onDelete, onDisableToggle, onEdit } = {}) {
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
				cell: (info) => (info.getValue() === "$scheme" ? "keep" : info.getValue()),
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
									tData={{ object: "redirection-host" }}
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
							<HasPermission section={REDIRECTION_HOSTS} permission={MANAGE} hideError>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										onDisableToggle?.(info.row.original.id, !info.row.original.enabled);
									}}
								>
									<IconPower className="icon dropdown-item-icon" aria-hidden="true" />
									<T id={info.row.original.enabled ? "action.disable" : "action.enable"} />
								</button>
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
		[onDelete, onDisableToggle, onEdit],
	);
}

export default function Table({
	data,
	isFetching,
	onEdit,
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
	const columns = useColumns({ onDelete, onDisableToggle, onEdit });

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
			showHeader={showHeader}
			groupBy={groupBy}
			renderGroupLabel={renderGroupLabel}
			emptyState={
				<EmptyData
					icon={IconArrowsCross}
					object="redirection-host"
					objects="redirection-hosts"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					color="yellow"
					permissionSection={REDIRECTION_HOSTS}
				/>
			}
		/>
	);
}
