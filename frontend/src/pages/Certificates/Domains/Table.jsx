import { createColumnHelper } from "@tanstack/react-table";
import { Eye, Globe, SquarePen, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
	Button,
	EmptyData,
	GravatarFormatter,
	HasPermission,
	RowActions,
	ValueWithDateFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { PagedTable } from "src/components/Table/TablePagination";
import { PAGED_FEATURES, useAppTable } from "src/components/Table/useAppTable";
import { TapTooltip } from "src/components/TapTooltip";
import { useCanManage, useDnsProviders, useUser } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDnsDomainsModal } from "src/modals";
import { displayDomain } from "src/modules/DnsDomainForms";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";

function DomainActions({ domain, onDelete, onEdit }) {
	const canManage = useCanManage(CERTIFICATES);
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart
			label={intl.formatMessage({ id: "list.row-actions" }, { name: domain.name })}
			focusKey={`dns-domain-${domain.id}`}
			title={<T id="object.actions-title" tData={{ object: "dns-domain" }} data={{ id: domain.id }} />}
			items={[
				{
					key: "edit",
					// a user who may only view gets the View window
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? SquarePen : Eye,
					primary: true,
					ariaLabel: canManage
						? intl.formatMessage({ id: "list.row-edit" }, { name: domain.name })
						: intl.formatMessage({ id: "list.row-view" }, { name: domain.name }),
					onSelect: () => onEdit?.(domain.id),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(domain.id),
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
	const { data: providers } = useDnsProviders();
	const { data: me } = useUser("me");
	const showOwner = me?.permissions?.visibility === "all";
	return useMemo(() => {
		const providerName = (id) => providers?.find((p) => p.id === id)?.name ?? id;
		return [
			...(showOwner
				? [
						columnHelper.accessor((row) => row.credential?.owner?.name, {
							id: "owner",
							enableSorting: false,
							header: intl.formatMessage({ id: "dns-domains.owner" }),
							cell: (info) => {
								const value = info.row.original.credential?.owner;
								return (
									<GravatarFormatter
										url={value ? value.avatar : ""}
										name={value ? value.name : intl.formatMessage({ id: "user.deleted" })}
									/>
								);
							},
							meta: {
								className: "w-px whitespace-nowrap pr-4",
								mobile: "hide-lg",
							},
						}),
					]
				: []),
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "dns-domains.name" }),
				cell: (info) => {
					const { name, createdOn } = info.row.original;
					const shown = displayDomain(name);
					return (
						<ValueWithDateFormatter
							value={shown}
							createdOn={createdOn}
							// the stored form under a name shown in Unicode
							below={shown === name ? null : <div className="text-muted-foreground">{name}</div>}
						/>
					);
				},
			}),
			columnHelper.accessor((row) => row.credential?.name ?? "", {
				id: "credential",
				meta: {
					mobile: "summary",
					summaryText: (row) => [row.credential?.name, providerName(row.credential?.provider)].join(", "),
				},
				header: intl.formatMessage({ id: "dns-domains.credential" }),
				cell: (info) => {
					const credential = info.row.original.credential;
					return (
						<>
							<div>{credential?.name}</div>
							<div className="text-muted-foreground">{providerName(credential?.provider)}</div>
						</>
					);
				},
			}),
			columnHelper.accessor((row) => row.source, {
				id: "source",
				// the source (typed or fetched) with the date in its tooltip: sorting by the source word is no use
				enableSorting: false,
				meta: {
					mobile: "summary",
					summaryText: (row) => intl.formatMessage({ id: `dns-domains.source.${row.source}` }),
				},
				header: intl.formatMessage({ id: "dns-domains.added" }),
				cell: (info) => (
					<TapTooltip
						content={intl.formatMessage(
							{ id: "dns-domains.added-on" },
							{ date: formatDateTime(info.row.original.createdOn) },
						)}
					>
						<span>
							<T id={`dns-domains.source.${info.getValue()}`} />
						</span>
					</TapTooltip>
				),
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => <DomainActions domain={info.row.original} {...info.table.options.meta?.actions} />,
				meta: {
					className: "text-right whitespace-nowrap",
					mobile: "title-end",
				},
			}),
		];
	}, [providers, showOwner]);
}

export default function Table({
	data,
	paging,
	isFetching,
	isFiltered,
	onClearFilters,
	onEdit,
	onDelete,
	sorting,
	onSortingChange,
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
						icon={Globe}
						tableInstance={tableInstance}
						isFiltered={isFiltered}
						onClearFilters={onClearFilters}
						section="dnsDomains"
						permissionSection={CERTIFICATES}
						message={<T id="dns-domains.empty" />}
						subtitle={<T id="dns-domains.empty-text" />}
						customAddBtn={
							<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
								<Button color="primary" onClick={() => showDnsDomainsModal()}>
									<T id="dns-domains.add" />
								</Button>
							</HasPermission>
						}
					/>
				}
			/>
		</PagedTable>
	);
}
