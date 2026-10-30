import { IconBolt, IconCopy, IconDotsVertical, IconEdit, IconPower, IconTrash } from "@tabler/icons-react";
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
	AccessListFormatter,
	CertificateFormatter,
	DomainsFormatter,
	EmptyData,
	GravatarFormatter,
	HasPermission,
	StatusFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { sectionColor } from "src/modules/SectionColors";

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

// shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns({ onClone, onDelete, onDisableToggle, onEdit } = {}) {
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
									tData={{ object: "proxy-host" }}
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
							<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										onClone?.(info.row.original.id);
									}}
								>
									<IconCopy className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="action.clone" />
								</button>
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
		[onClone, onDelete, onDisableToggle, onEdit],
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
	const columns = useColumns({ onClone, onDelete, onDisableToggle, onEdit });

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
					icon={IconBolt}
					object="proxy-host"
					objects="proxy-hosts"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					color={sectionColor("proxyHosts")}
					permissionSection={PROXY_HOSTS}
				/>
			}
		/>
	);
}
